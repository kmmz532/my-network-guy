// メールの届け方。送り手の端末 → 社内のメールサーバー（端末の設定）へ SMTP 25、
// そのサーバーが宛先のドメインの MX を DNS で引き、MX の名前の A を引いて、そのサーバーへ SMTP 25 で届ける。
// 宛先のサーバーが mail のサービスでそのドメインを受け持てば届く。途中の通信は、既存の到達の計算（ファイアウォール・NAT を通る）を使う。
import { getComponent } from '../components';
import { lookupName } from '../dns';
import type { DnsLookup } from '../dns';
import { tcpQuery } from '../engine/forward';
import type { NetworkState } from '../engine/state';
import { resolveName } from '../resolve';
import type { Failure, NetNode, PathResult } from '../types';

export type MailService = { protocol: 'mail'; domain: string };

// 届け方の記録。シーケンス図が、計算し直さずにこれを並べる
export interface MailTrace {
  // 端末から社内のメールサーバーまで。サーバーが決まらない（設定がない）ときは持たない
  client?: { server: string; leg: PathResult };
  // 社内のメールサーバーが宛先のドメインの MX を引いた結果。host は、優先度が最も高い MX のメールサーバーの名前（MX がなければ持たない）
  mx?: { name: string; lookup: DnsLookup; host?: string };
  // 社内のメールサーバーから MX のサーバーまで
  relay?: { server: string; leg: PathResult };
}

export type MailResult = { ok: true; domain: string; trace: MailTrace } | { ok: false; domain: string; failure: Failure; trace: MailTrace };

// 「user@domain」を、ドメインに分ける。形が正しくなければ例外
export const mailDomainOf = (address: string): string => {
  const parts = address.split('@');
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') throw new Error(`メールアドレスの形が不正: ${address}`);
  return parts[1];
};

const mailOf = (node: NetNode): MailService | undefined => node.services.find((s): s is MailService => s.protocol === 'mail');

// from の端末から address 宛にメールを送り、届くかを求める
export const mailDelivery = (state: NetworkState, fromUid: string, address: string): MailResult => {
  const { net, world } = state;
  const domain = mailDomainOf(address);
  const from = net.nodes.find((n) => n.uid === fromUid);
  if (!from) throw new Error(`機器が見つからない: ${fromUid}`);
  const trace: MailTrace = {};
  const stop = (reason: Failure['reason'], node: string, cause?: Failure): MailResult => ({ ok: false, domain, failure: { reason, node, ...(cause ? { cause } : {}) }, trace });

  // 1. 端末 → 社内のメールサーバー
  const serverIp = getComponent(from, 'mailClient')?.server;
  const server = serverIp === undefined ? undefined : net.nodes.find((n) => n.interfaces.some((i) => i.ip === serverIp));
  if (serverIp === undefined || !server || !mailOf(server)) return stop('mail.no_server', server?.uid ?? from.uid);
  const client = tcpQuery(state, from.uid, server.uid, 'smtp', serverIp);
  trace.client = { server: server.uid, leg: client };
  if (!client.ok) return { ok: false, domain, failure: client.failure!, trace };
  // 社内のメールサーバーが受け持つドメインなら、そのまま届く
  if (mailOf(server)!.domain === domain) return { ok: true, domain, trace };

  // 2. 社内のメールサーバーが、宛先のドメインの MX を引く
  const mx = lookupName(server, domain, 'MX', net, world);
  const records = mx.ok ? mx.records.filter((r) => r.type === 'MX').sort((a, b) => (a.pref ?? 0) - (b.pref ?? 0)) : [];
  if (records.length === 0) {
    trace.mx = { name: domain, lookup: mx };
    return stop('mail.no_mx', server.uid);
  }
  const best = records[0];
  trace.mx = { name: domain, lookup: mx, host: best.value };

  // 3. MX の名前の A を引く。引けなければ、そのサーバーへは届けられない
  const a = resolveName(server, best.value, net, world);
  if (!a.ok) return stop('mail.relay_failed', server.uid, { reason: 'name.unresolved', node: server.uid });
  const dest = net.nodes.find((n) => n.interfaces.some((i) => i.ip === a.ip));
  if (!dest) return stop('mail.relay_failed', server.uid, { reason: 'route.none', node: server.uid });

  // 4. 社内のメールサーバー → MX のサーバー（SMTP 25）
  const relay = tcpQuery(state, server.uid, dest.uid, 'smtp', a.ip);
  trace.relay = { server: dest.uid, leg: relay };
  if (!relay.ok) return stop('mail.relay_failed', server.uid, relay.failure);

  // 5. 届いたサーバーが、そのドメインを受け持つか
  if (mailOf(dest)!.domain !== domain) return stop('mail.unknown_domain', dest.uid);
  return { ok: true, domain, trace };
};
