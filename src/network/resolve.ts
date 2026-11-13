import { analyze } from './engine/analyze';
// 名前の解決（N68）。ping・traceroute の宛先の名前を、IPアドレスに直す純粋な関数。
// 引く順番: 1. 機器自身の対応表（ip host）→ 2. 機器のネームサーバー（ip name-server）→ 3. 見つからなければ失敗。
// ネームサーバーへの問い合わせは、ネームサーバーまで通信が届く場合だけ成功する（今の経路の計算 ping を使う）。
import { ping } from './engine';
import type { EngineData, Network, NetNode } from './types';

export type ResolveResult =
  | { ok: true; ip: string; via: 'hosts' | 'dns'; server?: string }
  | { ok: false; reason: 'dns.unreachable' | 'not_found'; server?: string };

export const resolveName = (from: NetNode, name: string, net: Network, data: EngineData): ResolveResult => {
  const own = (from.hosts ?? []).find((h) => h.name === name);
  if (own) return { ok: true, ip: own.ip, via: 'hosts' };
  if (!from.nameServer) return { ok: false, reason: 'not_found' };
  const serverIp = from.nameServer;
  const server = net.nodes.find((n) => n.dns !== undefined && n.interfaces.some((i) => i.ip === serverIp));
  // ネームサーバーの IPアドレスの機器が DNS でなければ、問い合わせに答えるものがない
  if (!server) return { ok: false, reason: 'dns.unreachable' };
  if (!ping(analyze(net, data), from.uid, server.uid).ok) return { ok: false, reason: 'dns.unreachable', server: server.uid };
  const hit = (server.dns?.zone ?? []).find((h) => h.name === name);
  return hit ? { ok: true, ip: hit.ip, via: 'dns', server: server.uid } : { ok: false, reason: 'not_found', server: server.uid };
};
