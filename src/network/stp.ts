// スパニングツリーの計算（純粋関数）。stp を持つスイッチの間のリンクだけを対象に、全体で1つの木を作る。
// - ルートブリッジ: 優先度（既定 32768）が最小、同じなら MAC アドレス（macSerial）が最小のスイッチ
// - ルートポート: ルートまでのコスト（口のコストの合計。既定は1口 4）が最小の口。同じなら相手のブリッジ ID、相手の口の番号の順
// - 指定ポート: 各リンクで、ルートに近い側。どちらでもない口は止める（ブロッキング）
import type { NetLink, NetNode } from './types';

export const STP_DEFAULT_PRIORITY = 32768;
export const STP_DEFAULT_COST = 4;

export type StpRole = 'root' | 'designated' | 'blocking';

export interface StpResult {
  // ルートブリッジの uid（スパニングツリーのスイッチがなければ null）
  root: string | null;
  // `${uid}:${port}` → 役割
  roles: Map<string, StpRole>;
  // ブリッジごとのルートまでのコスト
  rootCost: Map<string, number>;
}

const keyOf = (uid: string, port: number) => `${uid}:${port}`;

export const computeStp = (nodes: readonly NetNode[], links: readonly NetLink[], isStpSwitch: (node: NetNode) => boolean): StpResult => {
  const bridges = nodes.filter((n) => n.powered !== false && isStpSwitch(n));
  const byUid = new Map(bridges.map((n) => [n.uid, n]));
  const empty: StpResult = { root: null, roles: new Map(), rootCost: new Map() };
  if (bridges.length === 0) return empty;
  // ブリッジ ID（優先度・連番）の比較。小さいほうが強い
  const bid = (n: NetNode): [number, number] => [n.stpPriority ?? STP_DEFAULT_PRIORITY, n.macSerial ?? Number.MAX_SAFE_INTEGER];
  const cmpBid = (a: NetNode, b: NetNode) => bid(a)[0] - bid(b)[0] || bid(a)[1] - bid(b)[1];
  const cost = (n: NetNode, port: number) => n.ports.find((p) => p.port === port)?.stpCost ?? STP_DEFAULT_COST;
  const shut = (n: NetNode, port: number) => n.ports.find((p) => p.port === port)?.shutdown === true;

  // スイッチの間のリンク（両端とも stp のスイッチで、停止していない）
  const inner = links.filter((l) => byUid.has(l.a.node) && byUid.has(l.b.node) && l.a.node !== l.b.node && !shut(byUid.get(l.a.node)!, l.a.port) && !shut(byUid.get(l.b.node)!, l.b.port));
  const root = [...bridges].sort(cmpBid)[0];

  // ルートからのコスト（Bellman-Ford。コストは受け取る側の口のコスト）
  const dist = new Map<string, number>([[root.uid, 0]]);
  for (let round = 0; round < bridges.length; round++) {
    let changed = false;
    for (const l of inner) {
      for (const [from, to] of [[l.a, l.b], [l.b, l.a]] as const) {
        const d = dist.get(from.node);
        if (d === undefined) continue;
        const nd = d + cost(byUid.get(to.node)!, to.port);
        if (dist.get(to.node) === undefined || nd < (dist.get(to.node) as number)) {
          dist.set(to.node, nd);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // ルートポート: 各ブリッジ（ルート以外）で、ルートまでのコストが最小になる口。同じなら相手のブリッジ ID、相手の口の番号
  const rootPort = new Map<string, string>();
  for (const b of bridges) {
    if (b.uid === root.uid || dist.get(b.uid) === undefined) continue;
    const options = inner
      .flatMap((l) => [[l.a, l.b], [l.b, l.a]] as const)
      .filter(([me]) => me.node === b.uid)
      .map(([me, other]) => ({ me, other, total: (dist.get(other.node) ?? Infinity) + cost(b, me.port) }))
      .filter((o) => o.total === dist.get(b.uid))
      .sort((x, y) => cmpBid(byUid.get(x.other.node)!, byUid.get(y.other.node)!) || x.other.port - y.other.port);
    rootPort.set(b.uid, keyOf(b.uid, options[0].me.port));
  }

  // 各リンクの指定ポート: ルートまでのコストが小さい側。同じならブリッジ ID、口の番号の順。もう一方は、ルートポートでなければ止める
  const roles = new Map<string, StpRole>();
  for (const l of inner) {
    const [a, b] = [l.a, l.b];
    const da = dist.get(a.node);
    const db = dist.get(b.node);
    if (da === undefined || db === undefined) continue;
    const aWins = da !== db ? da < db : cmpBid(byUid.get(a.node)!, byUid.get(b.node)!) !== 0 ? cmpBid(byUid.get(a.node)!, byUid.get(b.node)!) < 0 : a.port < b.port;
    const [designated, other] = aWins ? [a, b] : [b, a];
    roles.set(keyOf(designated.node, designated.port), 'designated');
    roles.set(keyOf(other.node, other.port), rootPort.get(other.node) === keyOf(other.node, other.port) ? 'root' : 'blocking');
  }
  return { root: root.uid, roles, rootCost: dist };
};
