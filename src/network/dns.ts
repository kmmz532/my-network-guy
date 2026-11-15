// DNS の問い合わせ。PC → ネームサーバー（権威かキャッシュ）→ 転送先、と辿り、答えのレコードと問い合わせの経路を返す。
// 権威は自分のゾーンだけを答え、キャッシュはゾーンにない名前を転送先へ聞く。CNAME は辿る（8回まで）。
// ISP の DNS は仮想のインターネットで、インターネットから届く権威 DNS のゾーンと、仮想のインターネットの名前の表（EXTERNAL_ZONE）を答える。
// 問い合わせは 53 番への通信で、届かなければ（ファイアウォールの dns の規則を含む）答えが得られない。
import { dnsQuery } from './engine/forward';
import { analyze } from './engine/analyze';
import type { NetworkState } from './engine/state';
import { can } from './capabilities';
import { getComponent } from './components';
import { EXTERNAL_ZONE, withInternet, type IspDns } from './external';
import { DNS_PORT } from './types';
import type { DnsRecord, DnsRecordType, DnsService, EngineData, NetNode, Network } from './types';

export const MAX_CNAME = 8;
const MAX_FORWARD = 8;

// 問い合わせの1区間。recursive は「答えを求める」問い合わせ（PC → キャッシュ、キャッシュ → 転送先）、iterative は「分かる範囲を返してもらう」問い合わせ（ISP の DNS → 権威）
export interface DnsStep {
  from: string;
  to: string;
  mode: 'recursive' | 'iterative';
}

export type DnsLookup =
  | { ok: true; records: DnsRecord[]; server: string; steps: DnsStep[] }
  | { ok: false; reason: 'dns.unreachable' | 'not_found'; server?: string; steps: DnsStep[] };

interface Ctx {
  state: NetworkState;
  ispDns: IspDns[];
}

const ispOf = (c: Ctx, uid: string): IspDns | undefined => c.ispDns.find((i) => i.uid === uid);

// 機器の DNS のサービス。家庭用ルーターは、サービスを持たなくても、回線の ISP の DNS へ転送するキャッシュとして答える
const serviceOf = (c: Ctx, node: NetNode): DnsService | undefined => {
  const own = node.services.find((s): s is DnsService => s.protocol === 'dns');
  if (own) return own;
  // サービスを動かせて WAN の口を持つ機器（家庭用ルーター）
  if (!can(node.device, 'services') || !can(node.device, 'wan')) return undefined;
  const line = c.ispDns.find((i) => i.router === node.uid);
  return { protocol: 'dns', role: 'cache', zone: [], ...(line ? { forwarder: line.ip } : {}) };
};

// IPアドレスの機器（ISP の DNS の IP なら、その仮想の ISP の機器）
const nodeByIp = (c: Ctx, ip: string): NetNode | undefined => {
  const isp = c.ispDns.find((i) => i.ip === ip);
  if (isp) return c.state.net.nodes.find((n) => n.uid === isp.uid);
  return c.state.net.nodes.find((n) => n.interfaces.some((i) => i.ip === ip));
};

const unreachable = (server: string | undefined, steps: DnsStep[]): DnsLookup => ({ ok: false, reason: 'dns.unreachable', ...(server === undefined ? {} : { server }), steps });

type ZoneAnswer =
  | { kind: 'absent' }
  | { kind: 'nodata' }
  | { kind: 'loop' }
  | { kind: 'answer'; records: DnsRecord[] }
  // CNAME の先がゾーンの外。そこまでの鎖と、続きを引く名前
  | { kind: 'partial'; records: DnsRecord[]; next: string };

// サービスの持つゾーンから答える。CNAME は同じゾーンの中で辿る
const fromZone = (zone: readonly DnsRecord[], name: string, type: DnsRecordType, chain: DnsRecord[]): ZoneAnswer => {
  const here = zone.filter((r) => r.name === name);
  if (here.length === 0) return chain.length === 0 ? { kind: 'absent' } : { kind: 'partial', records: chain, next: name };
  const direct = here.filter((r) => r.type === type);
  if (direct.length > 0) return { kind: 'answer', records: [...chain, ...direct] };
  const cname = here.find((r) => r.type === 'CNAME');
  if (!cname || type === 'CNAME') return { kind: 'nodata' };
  if (chain.length >= MAX_CNAME) return { kind: 'loop' };
  return fromZone(zone, cname.value, type, [...chain, cname]);
};

const notFound = (server: string, steps: DnsStep[]): DnsLookup => ({ ok: false, reason: 'not_found', server, steps });

const answerAt = (c: Ctx, node: NetNode, svc: DnsService, name: string, type: DnsRecordType, steps: DnsStep[], first: string, chain: DnsRecord[], depth: number): DnsLookup => {
  const a = fromZone(svc.zone, name, type, chain);
  switch (a.kind) {
    case 'answer': return { ok: true, records: a.records, server: first, steps };
    case 'nodata':
    case 'loop': return notFound(first, steps);
    case 'absent': return forward(c, node, svc, name, type, steps, first, chain, depth);
    case 'partial': return forward(c, node, svc, a.next, type, steps, first, a.records, depth);
  }
};

const forward = (c: Ctx, node: NetNode, svc: DnsService, name: string, type: DnsRecordType, steps: DnsStep[], first: string, chain: DnsRecord[], depth: number): DnsLookup => {
  if (svc.role !== 'cache' || svc.forwarder === undefined || depth >= MAX_FORWARD) return notFound(first, steps);
  const target = nodeByIp(c, svc.forwarder);
  if (!target) return unreachable(first, steps);
  return ask(c, node.uid, target, svc.forwarder, name, type, 'recursive', steps, first, chain, depth + 1);
};

// ISP の DNS: インターネットから届く権威 DNS のゾーン → 仮想のインターネットの名前の表
const askIsp = (c: Ctx, isp: NetNode, name: string, type: DnsRecordType, steps: DnsStep[], first: string, chain: DnsRecord[]): DnsLookup => {
  const servers = c.state.net.nodes.filter((n) => !c.ispDns.some((i) => i.uid === n.uid) && n.services.some((s) => s.protocol === 'dns' && s.role === 'auth' && s.zone.some((r) => r.name === name)));
  for (const server of servers) {
    // 外から届く先: サーバー自身、または 53 番を静的 NAT でサーバーへ転送するルーター
    const ips = new Set(server.interfaces.map((i) => i.ip));
    const via = [server, ...c.state.net.nodes.filter((n) => getComponent(n, 'nat')?.statics?.some((s) => s.port === DNS_PORT && ips.has(s.insideIp)))];
    const reach = via.find((v) => dnsQuery(c.state, isp.uid, v.uid).ok);
    steps.push({ from: isp.uid, to: server.uid, mode: 'iterative' });
    if (!reach) return unreachable(first, steps);
    const svc = server.services.find((s): s is DnsService => s.protocol === 'dns')!;
    return answerAt(c, server, svc, name, type, steps, first, chain, MAX_FORWARD);
  }
  return answerAt(c, isp, { protocol: 'dns', role: 'auth', zone: [...EXTERNAL_ZONE] }, name, type, steps, first, chain, MAX_FORWARD);
};

const ask = (c: Ctx, fromUid: string, target: NetNode, ip: string, name: string, type: DnsRecordType, mode: DnsStep['mode'], steps: DnsStep[], first: string | undefined, chain: DnsRecord[], depth: number): DnsLookup => {
  steps.push({ from: fromUid, to: target.uid, mode });
  const head = first ?? target.uid;
  const isp = ispOf(c, target.uid);
  const svc = isp ? undefined : serviceOf(c, target);
  if (!isp && !svc) return unreachable(first, steps);
  if (!dnsQuery(c.state, fromUid, target.uid, isp ? undefined : ip).ok) return unreachable(head, steps);
  if (isp) return askIsp(c, target, name, type, steps, head, chain);
  return answerAt(c, target, svc!, name, type, steps, head, chain, depth);
};

// 名前を、ネームサーバーの IPアドレス（from.nameServer）の DNS サービスへ問い合わせる。type の記録を返す（CNAME は辿った鎖が先に並ぶ）
export const lookupName = (from: NetNode, name: string, type: DnsRecordType, net: Network, data: EngineData): DnsLookup => {
  if (!from.nameServer) return { ok: false, reason: 'not_found', steps: [] };
  const withNet = withInternet(net, data);
  const c: Ctx = { state: analyze(withNet ?? net, data), ispDns: withNet?.ispDns ?? [] };
  const target = nodeByIp(c, from.nameServer);
  const steps: DnsStep[] = [];
  if (!target) return unreachable(undefined, steps);
  return ask(c, from.uid, target, from.nameServer, name, type, 'recursive', steps, undefined, [], 0);
};
