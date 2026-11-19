// ロードバランサーの振り分け先の健全の判定と、振り分け先の選び方。転送そのもの（forward.ts）は、ここで決めた先へ届けるだけ
import type { Components } from '../components';
import type { ForwardView, Traffic } from '../engine/forward';
import { inSubnet, ipToInt } from '../ip';
import type { Iface, NetNode, PathResult } from '../types';

export type VirtualServer = NonNullable<Components['loadBalancer']>[number];
export type Member = VirtualServer['members'][number];

// ロードバランサーの口から（またはサーバーから）の片道。復路の判定はしない（check なし）
export type Reach = (view: ForwardView, from: string, to: string, traffic: Traffic, srcIp: string, dstIp: string) => PathResult;

// 振り分け先のアドレスを持つ機器
export const serverOf = (view: ForwardView, member: Member): NetNode | undefined => view.addressing.net.nodes.find((n) => n.interfaces.some((i) => i.ip === member.ip));

// 振り分け先へ出る、ロードバランサーの口。同じサブネットの口、なければ経路表の次の機器へ向く口、なければゲートウェイへ向く口。どれもなければ undefined
export const egressIface = (view: ForwardView, lb: NetNode, dstIp: string): Iface | undefined => {
  const direct = lb.interfaces.find((i) => inSubnet(dstIp, i.ip, i.prefix));
  if (direct) return direct;
  const matches = view.routing.routesOf(lb.uid).filter((r) => inSubnet(dstIp, r.dest, r.prefix));
  if (matches.length > 0) {
    const route = matches.reduce((best, r) => (r.prefix > best.prefix ? r : best));
    return lb.interfaces.find((i) => inSubnet(route.nextHop, i.ip, i.prefix));
  }
  const gateway = lb.gateway;
  return gateway === null || gateway === undefined ? undefined : lb.interfaces.find((i) => inSubnet(gateway, i.ip, i.prefix));
};

// 振り分け先が、そのトラフィックの往復に応えるか。ping は ping が通ること、http はそのポートでサービスが動いていること
export const memberUp = (view: ForwardView, lb: NetNode, member: Member, kind: 'ping' | 'http', reach: Reach): boolean => {
  const server = serverOf(view, member);
  const iface = egressIface(view, lb, member.ip);
  if (!server || !iface) return false;
  const traffic: Traffic = kind === 'http' ? { kind: 'http', port: member.port } : { kind: 'ping' };
  if (!reach(view, lb.uid, server.uid, traffic, iface.ip, member.ip).ok) return false;
  if (kind === 'http' && !server.services.some((s) => s.protocol === 'http' && s.port === member.port)) return false;
  return reach(view, server.uid, lb.uid, traffic, member.ip, iface.ip).ok;
};

// 健全な振り分け先。none は全員を健全とみなす
export const healthyMembers = (view: ForwardView, lb: NetNode, vs: VirtualServer, reach: Reach): Member[] => {
  const check = vs.healthCheck;
  return check === 'none' ? vs.members : vs.members.filter((m) => memberUp(view, lb, m, check, reach));
};

// 振り分け先の選び方（結果は決まったものになる）。
// round_robin は、アドレスを持つ機器の uid を名前順（文字コード順）に並べた中の、送信元の順位を、健全な振り分け先の数で割った余り。
// source_ip は、送信元の IPv4 を数値にして、健全な振り分け先の数で割った余り
export const pickMember = (view: ForwardView, method: VirtualServer['method'], healthy: readonly Member[], source: { uid: string; ip: string }): Member => {
  if (healthy.length === 0) throw new Error('健全な振り分け先がない');
  if (method === 'source_ip') return healthy[ipToInt(source.ip) % healthy.length];
  const uids = view.addressing.net.nodes.filter((n) => n.interfaces.length > 0).map((n) => n.uid).sort();
  const rank = uids.indexOf(source.uid);
  if (rank < 0) throw new Error(`送信元がアドレスを持つ機器の中にない: ${source.uid}`);
  return healthy[rank % healthy.length];
};
