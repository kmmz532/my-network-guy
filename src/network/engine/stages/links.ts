// 段A 配線: 無線の結びつきと仮想の配線、論理リンク（LAG）、口の停止、配線の長さの超過
import { CATEGORY } from '../../../data/categories';
import { cableMaxLength, deviceCategory, portSpeed } from '../../../registry/query';
import { can } from '../../capabilities';
import { computeLags, type LagResult } from '../../lag';
import { macOf } from '../../mac';
import type { EngineData, NetLink, NetNode, Network, PortConfig } from '../../types';

// 配線の長さ（タイル数）。折れ点ごとの縦横の距離の合計
export const linkLength = (path: [number, number][]): number => {
  let length = 0;
  for (let i = 1; i < path.length; i++) {
    length += Math.abs(path[i][0] - path[i - 1][0]) + Math.abs(path[i][1] - path[i - 1][1]);
  }
  return length;
};

// 電波の範囲（マス。仮の値・WIRELESS.md §3 の減衰は後続）。範囲の中の無線の端末は、最も近いアクセスポイントの LAN に入る（N151）
export const WIRELESS_RADIUS = 6;
// 壁1マスを通るごとに、電波の届く距離から失われるマス数（仮の値・WIRELESS.md §3）
export const WALL_LOSS = 2;

// アクセスポイントから端末までの経路（x を先、次に y）にある壁のマスの数（両端は数えない）
export const wallsBetween = (wallAt: (x: number, y: number) => boolean, ax: number, ay: number, cx: number, cy: number): number => {
  let count = 0;
  let x = ax;
  let y = ay;
  const toward = (v: number, target: number) => (v < target ? v + 1 : v - 1);
  while (x !== cx) {
    x = toward(x, cx);
    if (!(x === cx && y === cy) && wallAt(x, y)) count++;
  }
  while (y !== cy) {
    y = toward(y, cy);
    if (!(x === cx && y === cy) && wallAt(x, y)) count++;
  }
  return count;
};

// 無線の端末を、最も近いアクセスポイントへ仮想の配線でつなぐ（段1の仮想の配線）。
// 端末の口0 に配線がなく、無線の能力を持ち、範囲の中にアクセスポイントがあるとき。アクセスポイントの口は 100 番から、端末ごとに1つ使う
// 無線の端末は、SSID とパスワードが合い、範囲の中にあるアクセスポイントの中で最も近いものにつながる（N151）。
// アクセスポイントの無線の VLAN は、つながった端末の口を、その VLAN の access の口として扱う
// アクセスポイント（と無線つきの家庭用ルーター）
export const accessPointsOf = (net: Network, _data: EngineData): NetNode[] =>
  net.nodes.filter((n) => deviceCategory(n.device) === CATEGORY.accessPoint || deviceCategory(n.device) === CATEGORY.homeRouter);

// 無線の端末とつながるアクセスポイントの組（端末ごとに最も近い、SSID・パスワードの合う、範囲の中のもの）。画面の点線にも使う（N151・N152）
export const wirelessAssociations = (net: Network, data: EngineData): { ap: NetNode; client: NetNode }[] => {
  const aps = net.nodes.filter((n) => deviceCategory(n.device) === CATEGORY.accessPoint || deviceCategory(n.device) === CATEGORY.homeRouter);
  if (aps.length === 0) return [];
  const wired = new Set(net.links.flatMap((l) => [`${l.a.node}:${l.a.port}`, `${l.b.node}:${l.b.port}`]));
  const out: { ap: NetNode; client: NetNode }[] = [];
  for (const c of net.nodes) {
    // アクセスポイント（と無線つきの家庭用ルーター）は端末ではない。端末は無線の能力を持つ機器のうち、ほかの接続の口0がないもの
    if (!can(c.device, 'wireless') || wired.has(`${c.uid}:0`)) continue;
    if (aps.includes(c)) continue;
    let best: { ap: NetNode; d: number } | undefined;
    for (const ap of aps) {
      const d = Math.abs(ap.x - c.x) + Math.abs(ap.y - c.y);
      // SSID とパスワードが合うこと（どちらかがなければ、つながらない）
      const w = ap.wireless;
      const cw = c.wireless;
      const security = w?.security ?? 'wpa2';
      // パスワードは、暗号化のない SSID では要らない。WPA3 だけの SSID は、WPA3 に対応する端末だけがつながる
      if (w?.ssid === undefined || cw?.ssid !== w.ssid || (security !== 'open' && cw.password !== w.password)) continue;
      if (security === 'wpa3' && !can(c.device, 'wpa3')) continue;
      // 無線の MAC フィルター（N153）: 登録のない端末は通さない
      if (w.macs !== undefined && (c.macSerial === undefined || !w.macs.includes(macOf(deviceCategory(c.device), c.macSerial, 0)))) continue;
      // 壁を通るたびに減衰し、減衰後に届く範囲だけが有効（壁の判定がないときは減衰しない）
      const walls = wallsBetween(data.wallAt, ap.x, ap.y, c.x, c.y);
      if (d + walls * WALL_LOSS <= WIRELESS_RADIUS && (best === undefined || d < best.d || (d === best.d && ap.uid < best.ap.uid))) best = { ap, d };
    }
    if (best) out.push({ ap: best.ap, client: c });
  }
  return out;
};

// 無線の端末を、つながるアクセスポイントへ仮想の配線でつなぐ（段1の仮想の配線）。アクセスポイントの口は 100 番から、端末ごとに1つ使う
export const withWireless = (net: Network, data: EngineData): Network => {
  const pairs = wirelessAssociations(net, data);
  if (pairs.length === 0) return net;
  const extra: NetLink[] = [];
  const nextPort = new Map<string, number>();
  const apPorts = new Map<string, PortConfig[]>();
  for (const { ap, client: c } of pairs) {
    const port = 100 + (nextPort.get(ap.uid) ?? 0);
    nextPort.set(ap.uid, port - 100 + 1);
    apPorts.set(ap.uid, [...(apPorts.get(ap.uid) ?? []), { port, mode: 'access', vlan: ap.wireless?.vlan ?? 1 }]);
    extra.push({ uid: `__wifi_${c.uid}`, cable: 'utp_cat5e', a: { node: ap.uid, port }, b: { node: c.uid, port: 0 }, path: [[ap.x, ap.y], [c.x, c.y]], paid: 0 });
  }
  // アクセスポイントの口（つないだ端末の口）に、無線の VLAN を付ける
  const nodes = net.nodes.map((n) => (apPorts.has(n.uid) ? { ...n, ports: [...n.ports, ...apPorts.get(n.uid)!] } : n));
  return { ...net, nodes, links: [...net.links, ...extra] };
};

export interface LinkLayer {
  // 無線の端末とつながるアクセスポイントの組
  readonly associations: readonly { ap: NetNode; client: NetNode }[];
  // 無線の仮想の配線（とアクセスポイントの口の設定）を入れた構成
  readonly net: Network;
  // 論理リンク（リンクアグリゲーション）
  readonly lag: LagResult;
  // 口が停止しているか（shutdown・電源を切った機器）
  isShut(uid: string, port: number): boolean;
  // 長さが上限を超えた配線の uid
  readonly tooLong: ReadonlySet<string>;
}

export const stageLinks = (input: Network, world: EngineData): LinkLayer => {
  const associations = wirelessAssociations(input, world);
  const net = withWireless(input, world);
  const lag = computeLags(net.nodes, net.links, (n) => can(n.device, 'lag'), (n, port) => portSpeed(n.device, port));
  const poweredOff = new Set<string>();
  const shut = new Set<string>();
  for (const n of net.nodes) {
    if (n.powered === false) poweredOff.add(n.uid);
    // 同じ番号の設定が複数あれば、最初のものに従う
    const seen = new Set<number>();
    for (const p of n.ports ?? []) {
      if (seen.has(p.port)) continue;
      seen.add(p.port);
      if (p.shutdown === true) shut.add(`${n.uid}:${p.port}`);
    }
  }
  const tooLong = new Set(net.links.filter((l) => linkLength(l.path) > cableMaxLength(l.cable)).map((l) => l.uid));
  return {
    associations,
    net,
    lag,
    isShut: (uid, port) => poweredOff.has(uid) || shut.has(`${uid}:${port}`),
    tooLong,
  };
};
