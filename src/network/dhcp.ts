// DHCP の割り当て（純粋関数。NET.md §5.7）。自動（dhcp）のインターフェースごとに、同じブロードキャストドメインのサーバー、
// なければリレー（helper）先のサーバーのプールから、使われていない最も小さいアドレスを配る。
// クライアントは機器の連番の順に、前回のアドレス（iface.ip）が今のプールの範囲内で先の口に取られていなければそれを使い、なければ空いている最も小さいアドレスを配る。
// 受け取れた口の ip・prefix は、store が機器へ書き戻す（dhcpWriteBack）ため、機器を消しても後ろの機器のアドレスは動かない
import { ipToInt, inSubnet } from './engine';
import type { Endpoint, Iface, NetNode } from './types';

export interface DhcpPool {
  network: string;
  prefix: number;
  // 配る範囲（両端を含む）
  start: string;
  end: string;
  gateway?: string;
  dns?: string;
}

export interface DhcpLease {
  uid: string;
  port: number;
  ip: string;
  prefix: number;
  gateway?: string;
  dns?: string;
  // 配ったサーバーの機器
  server: string;
}

export type DhcpFailure = 'dhcp.no_offer' | 'dhcp.exhausted';

export interface DhcpResult {
  leases: DhcpLease[];
  failed: { uid: string; port: number; reason: DhcpFailure }[];
  // 複数のサーバーが見つかったクライアント（uid・口・見つかったサーバーの uid）
  multiple: { uid: string; port: number; servers: string[] }[];
}

export interface DhcpEnv {
  // 口と同じブロードキャストドメインにある端点（自分を含んでよい）
  domainOf: (uid: string, port: number) => Endpoint[];
  // ルーターの口（routerIp）から、リレー先のサーバーのアドレス（serverIp）へ届くか
  reaches: (routerUid: string, routerIp: string, serverUid: string, serverIp: string) => boolean;
}

// サーバー・ルーターの、アドレスのある口（自動の口は含めない）
const ifaceOn = (node: NetNode, port: number): Iface | undefined => node.interfaces.find((i) => i.port === port && i.dhcp !== true);

// プールの範囲のアドレスを小さい順に出す
const addressesOf = (pool: DhcpPool): string[] => {
  const out: string[] = [];
  for (let n = ipToInt(pool.start); n <= ipToInt(pool.end); n++) out.push([24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.'));
  return out;
};

export const assignDhcp = (nodes: readonly NetNode[], env: DhcpEnv): DhcpResult => {
  const result: DhcpResult = { leases: [], failed: [], multiple: [] };
  const servers = nodes.filter((n) => (n.dhcpPools?.length ?? 0) > 0);
  const used = new Map<string, Set<string>>();
  const clients = nodes
    .filter((n) => n.interfaces.some((i) => i.dhcp === true))
    .sort((a, b) => (a.macSerial ?? Number.MAX_SAFE_INTEGER) - (b.macSerial ?? Number.MAX_SAFE_INTEGER));
  for (const client of clients) {
    for (const iface of client.interfaces.filter((i) => i.dhcp === true)) {
      const members = env.domainOf(client.uid, iface.port);
      // 同じドメインのサーバー（サーバーの口のアドレスが、プールのネットワークの中）
      let found: { server: NetNode; pool: DhcpPool }[] = [];
      for (const m of members) {
        const s = servers.find((x) => x.uid === m.node);
        const si = s ? ifaceOn(s, m.port) : undefined;
        const pool = s && si ? s.dhcpPools!.find((p) => inSubnet(si.ip, p.network, p.prefix)) : undefined;
        if (s && pool && s.uid !== client.uid) found.push({ server: s, pool });
      }
      // なければ、同じドメインのリレー（helper）を持つルーターの口から、リレー先のサーバーへ
      if (found.length === 0) {
        for (const m of members) {
          const r = nodes.find((x) => x.uid === m.node);
          const ri = r ? ifaceOn(r, m.port) : undefined;
          if (!r || !ri?.helper) continue;
          const s = servers.find((x) => x.interfaces.some((i) => i.ip === ri.helper));
          const pool = s?.dhcpPools!.find((p) => inSubnet(ri.ip, p.network, p.prefix));
          if (s && pool && env.reaches(r.uid, ri.ip, s.uid, ri.helper)) found.push({ server: s, pool });
        }
      }
      found = found.filter((f, i) => found.findIndex((g) => g.server.uid === f.server.uid && g.pool === f.pool) === i);
      if (found.length === 0) {
        result.failed.push({ uid: client.uid, port: iface.port, reason: 'dhcp.no_offer' });
        continue;
      }
      // MAC アドレス（連番）が最も小さい機器から受け取る
      found.sort((a, b) => (a.server.macSerial ?? Number.MAX_SAFE_INTEGER) - (b.server.macSerial ?? Number.MAX_SAFE_INTEGER));
      if (new Set(found.map((f) => f.server.uid)).size > 1) result.multiple.push({ uid: client.uid, port: iface.port, servers: [...new Set(found.map((f) => f.server.uid))] });
      const { server, pool } = found[0];
      const key = `${server.uid}|${pool.network}/${pool.prefix}`;
      const taken = used.get(key) ?? used.set(key, new Set()).get(key)!;
      const addresses = addressesOf(pool);
      const previous = iface.ip;
      const ip = addresses.includes(previous) && !taken.has(previous) ? previous : addresses.find((a) => !taken.has(a));
      if (ip === undefined) {
        result.failed.push({ uid: client.uid, port: iface.port, reason: 'dhcp.exhausted' });
        continue;
      }
      taken.add(ip);
      result.leases.push({ uid: client.uid, port: iface.port, ip, prefix: pool.prefix, ...(pool.gateway ? { gateway: pool.gateway } : {}), ...(pool.dns ? { dns: pool.dns } : {}), server: server.uid });
    }
  }
  return result;
};
