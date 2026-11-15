// 名前の解決（N68）。ping・traceroute の宛先の名前を、IPアドレスに直す純粋な関数。
// 引く順番: 1. 機器自身の対応表（ip host）→ 2. 機器のネームサーバー（ip name-server）の DNS サービス（dns.ts）→ 3. 見つからなければ失敗。
import { getComponent } from './components';
import { lookupName, type DnsStep } from './dns';
import type { EngineData, Network, NetNode } from './types';

export type ResolveResult =
  | { ok: true; ip: string; via: 'hosts' | 'dns'; server?: string; steps?: DnsStep[] }
  | { ok: false; reason: 'dns.unreachable' | 'not_found'; server?: string };

export const resolveName = (from: NetNode, name: string, net: Network, data: EngineData): ResolveResult => {
  const own = (getComponent(from, 'resolver')?.hosts ?? []).find((h) => h.name === name);
  if (own) return { ok: true, ip: own.ip, via: 'hosts' };
  const r = lookupName(from, name, 'A', net, data);
  if (!r.ok) return { ok: false, reason: r.reason, ...(r.server === undefined ? {} : { server: r.server }) };
  return { ok: true, ip: r.records[r.records.length - 1].value, via: 'dns', server: r.server, steps: r.steps };
};
