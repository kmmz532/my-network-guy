// 定型案件の予算。最安の設計の費用に余裕の倍率（template.budget.margin）を掛けた額にする。
import type { ContractTemplate, GameMap, Goal } from '../data/schema';
import type { DeviceDef } from '../registry/defs';
import { registries } from '../registry/game';
import { cableDef, deviceCategory } from '../registry/query';
import { spawnGroupsOf, starHubOf } from './spawn';

// 費用を求められる目標の型と、台数の目標の種類（ほかは、この設計に含まれない）
const COSTED_GOALS = new Set(['ping_all', 'count', 'count_device', 'reach_category', 'http_all', 'http_from', 'isolated', 'blocked_all']);
const COSTED_CATEGORIES = new Set(['router', 'router_switch', 'server', 'printer', 'firewall', 'l3_switch']);

const deviceList = registries.devices.all();
const cheapest = (category: string, minPorts: number, sfp = false): DeviceDef | undefined =>
  deviceList
    .filter((d) => deviceCategory(d.id) === category && d.ports.reduce((s, p) => s + p.count, 0) >= minPorts && (!sfp || d.ports.some((p) => p.type === 'sfp')))
    .sort((a, b) => a.price - b.price)[0];

// 台数の目標（count）が数える機器の種類。台数の目標でなければ null
const countedKindOf = (g: Goal): string | null => (g.type === 'count' ? g.category : null);

type Pt = { x: number; y: number };
const dist = (a: Pt, b: Pt) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const utp = cableDef('utp_cat5e');
const fiber = cableDef('fiber_sm');
// 1本のケーブルの費用。UTP で届かない距離は光ファイバーにする
const linkCost = (d: number): number => {
  const c = d <= utp.maxLengthTiles ? utp : fiber;
  return c.pricePerLink + c.pricePerTile * d;
};

// 最安の設計の費用（機器と配線）。PC 自体は案件で置かれているため含めない。
// 設計: 各グループの PC を、その範囲の配線の中心に置いたスイッチ1台（台数が収まる最も安いもの）でつなぐ。
// 目標に count があれば、その機器を最も安い値段で足す。グループが複数のときは、ルーターか中継のスイッチで結ぶ。
// 値段は、機器とケーブルの定義から引く。求められない目標の型は例外で止める
export const optimalCostOf = (template: ContractTemplate, map: GameMap, placed: readonly Pt[], furniture: readonly Pt[]): number => {
  for (const g of template.goals) {
    if (!COSTED_GOALS.has(g.type)) throw new Error(`${template.id}: 目標 ${g.type} は最安の設計の費用を求められない`);
    const kind = countedKindOf(g);
    if (kind !== null && !COSTED_CATEGORIES.has(kind)) throw new Error(`${template.id}: 台数の目標の種類 ${kind} は最安の設計の費用を求められない`);
  }
  const goalCount = (category: string) =>
    template.goals.filter((g) => countedKindOf(g) === category).reduce((s, g) => s + (g.type === 'count' ? g.min : 0), 0);
  const hasHttp = template.goals.some((g) => g.type === 'http_all' || g.type === 'http_from');
  // isolated の goals があるときは、互いに通信させない役割のグループを別のネットワークにする（つながりの組ごとに中継する）
  const isolatedRoles = new Set(template.goals.flatMap((g) => (g.type === 'isolated' ? g.from.map((r) => r.replace('$role:', '')) : [])));
  const rawGroups = spawnGroupsOf(template);
  // 同じネットワーク（subnet）の範囲は、スイッチ1台でつなぐ1つのグループとして数える
  const groups = rawGroups.filter((g, i) => g.subnet === undefined || rawGroups.findIndex((h) => h.subnet === g.subnet) === i);
  // 1マスの置く範囲（端に固定した PC）があるひな形は、機器が UTP の上限を超えて離れる。PC を x の中央で左右に分け、左右に1台ずつスイッチを置いて結ぶ
  // （左右のスイッチの間が上限を超えれば、中継のスイッチを足す。l3_switch の台数の目標があれば、スイッチは l3_switch で、間は光ファイバーでつなぐ）
  if (groups.some((g) => g.width === 1 && g.height === 1)) {
    const xs = placed.map((p) => p.x);
    const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
    const sides = [placed.filter((p) => p.x <= mid), placed.filter((p) => p.x > mid)];
    const viaL3 = goalCount('l3_switch') > 0;
    let spanCost = 0;
    const spanHubs: Pt[] = [];
    for (const pcs of sides) {
      const device = cheapest(viaL3 ? 'l3_switch' : 'l2_switch', pcs.length + 1);
      if (!device) throw new Error('スイッチがない');
      spanCost += device.price;
      const hub = starHubOf(pcs, map, utp.maxLengthTiles, furniture);
      spanHubs.push({ x: hub.x, y: hub.y });
      for (const p of pcs) spanCost += linkCost(dist(p, hub));
    }
    const between = dist(spanHubs[0], spanHubs[1]);
    if (viaL3 || between <= utp.maxLengthTiles) spanCost += linkCost(between);
    else {
      const center = starHubOf(spanHubs.map((h) => ({ ...h, ref: '' })), map, undefined, furniture);
      const relay = cheapest('l2_switch', 2);
      if (!relay) throw new Error('中継のスイッチがない');
      spanCost += relay.price + spanHubs.reduce((sum, h) => sum + linkCost(dist(h, center)), 0);
    }
    return spanCost;
  }
  let cost = 0;
  // グループごとの PC の位置。範囲は instantiate の並びの順（pc_1 から連番）
  const pcsOfRaw: Pt[][] = [];
  let k = 0;
  for (const g of rawGroups) {
    const n = placed.filter((p) => p.x >= g.x && p.x < g.x + g.width && p.y >= g.y && p.y < g.y + g.height).length;
    pcsOfRaw.push(placed.slice(k, k + n));
    k += n;
  }
  const pcsOf = groups.map((g) => rawGroups.flatMap((h, i) => (h === g || (g.subnet !== undefined && h.subnet === g.subnet) ? pcsOfRaw[i] : [])));
  const uplink = groups.length > 1 ? 1 : 0;
  const hubs: Pt[] = [];
  for (const pcs of pcsOf) {
    const need = pcs.length + uplink + (groups.length === 1 && goalCount('printer') > 0 ? 1 : 0);
    // 複数のグループを l3_switch の台数の目標で結ぶときは、グループごとのスイッチを l3_switch にする（光ファイバーの口が要る）
    const viaL3 = goalCount('l3_switch') > 0 && groups.length > 1;
    const hubDevice = goalCount('router_switch') > 0 && groups.length === 1 ? cheapest('router_switch', need) : cheapest(viaL3 ? 'l3_switch' : 'l2_switch', need);
    if (hubDevice) {
      cost += hubDevice.price;
    } else {
      // 1台に収まらないときは、最大のポート数のスイッチを複数使い、1本ずつ（1マス）でつなぐ
      const largest = deviceList.filter((d) => deviceCategory(d.id) === 'l2_switch').sort((a, b) => b.ports.reduce((s, p) => s + p.count, 0) - a.ports.reduce((s, p) => s + p.count, 0))[0];
      const ports = largest.ports.reduce((s, p) => s + p.count, 0);
      const count = Math.ceil(need / ports);
      cost += count * largest.price + (count - 1) * linkCost(1);
    }
    const hub = starHubOf(pcs, map, utp.maxLengthTiles, furniture);
    hubs.push({ x: hub.x, y: hub.y });
    for (const p of pcs) cost += linkCost(dist(p, hub));
  }
  // つなぐグループの組。isolated で分けた役割の組は別のネットワークにし、分けられていないグループどうしだけをつなぐ
  const separated = (i: number, j: number): boolean =>
    template.goals.some((g) => {
      if (g.type !== 'isolated') return false;
      const has = (list: readonly string[], role: string | undefined) => role !== undefined && list.includes(`$role:${role}`);
      return (has(g.from, groups[i].role) && has(g.to, groups[j].role)) || (has(g.from, groups[j].role) && has(g.to, groups[i].role));
    });
  const component = hubs.map((_, i) => i);
  const find = (i: number): number => (component[i] === i ? i : (component[i] = find(component[i])));
  if (isolatedRoles.size && goalCount('firewall') === 0) {
    for (let i = 0; i < hubs.length; i++) for (let j = i + 1; j < hubs.length; j++) if (!separated(i, j)) component[find(j)] = find(i);
  }
  const sets: Pt[][] = isolatedRoles.size && goalCount('firewall') === 0 ? [...new Set(component.map((_, i) => find(i)))].map((c) => hubs.filter((_, i) => find(i) === c)) : [hubs];
  for (const set of isolatedRoles.size && goalCount('firewall') === 0 ? sets : []) {
    if (set.length < 2) continue;
    const center = starHubOf(set.map((h) => ({ ...h, ref: '' })), map, undefined, furniture);
    if (set.length === 2 && dist(set[0], set[1]) <= utp.maxLengthTiles) cost += linkCost(dist(set[0], set[1]));
    else {
      cost += (cheapest('l2_switch', set.length)?.price ?? 0);
      for (const h of set) cost += linkCost(dist(h, center));
    }
  }
  if (groups.length > 1 && (!isolatedRoles.size || goalCount('firewall') > 0)) {
    const center = starHubOf(hubs.map((h) => ({ ...h, ref: '' })), map, undefined, furniture);
    if (goalCount('firewall') > 0) {
      const fw = cheapest('firewall', groups.length);
      if (!fw) throw new Error('ファイアウォールがない');
      cost += fw.price;
      for (const h of hubs) cost += linkCost(dist(h, center));
    } else if (goalCount('router') >= groups.length) {
      // 拠点ごとにルーターを置き、SFP の口どうしを光ファイバーで結ぶ（拠点の間が上限を超える。ルーターは SFP の口があるもの）
      const sfpRouter = cheapest('router', 1, true);
      if (!sfpRouter) throw new Error('SFP のルーターがない');
      cost += sfpRouter.price * groups.length + linkCost(1) * hubs.length;
      for (let i = 1; i < hubs.length; i++) cost += linkCost(dist(hubs[i - 1], hubs[i]));
    } else if (goalCount('router') > 0) {
      const router = cheapest('router', groups.length);
      if (!router) throw new Error('ルーターがない');
      cost += router.price;
      for (const h of hubs) cost += linkCost(dist(h, center));
    } else {
      const direct = hubs.length === 2 && (dist(hubs[0], hubs[1]) <= utp.maxLengthTiles || goalCount('l3_switch') > 0);
      if (direct) {
        cost += linkCost(dist(hubs[0], hubs[1]));
      } else {
        const relay = cheapest('l2_switch', hubs.length);
        if (!relay) throw new Error('中継のスイッチがない');
        cost += relay.price;
        for (const h of hubs) cost += linkCost(dist(h, center));
      }
    }
  }
  if (goalCount('router') > 0 && groups.length === 1) {
    const router = cheapest('router', 1);
    if (!router) throw new Error('ルーターがない');
    cost += router.price + linkCost(1);
  }
  // プリンター（count printer）は、台数の分だけ、スイッチに1本ずつで足す
  if (goalCount('printer') > 0) {
    const printer = cheapest('printer', 1);
    if (!printer) throw new Error('プリンターがない');
    cost += (printer.price + linkCost(1)) * goalCount('printer');
  }
  // 型で数える機器（count_device。GPUサーバーなど）は、その機器の価格と1本の配線を足す。サーバーの役も兼ねる
  const byDevice = template.goals.flatMap((g) => (g.type === 'count_device' ? [g] : []));
  for (const g of byDevice) {
    const d = deviceList.find((x) => x.id === g.device);
    if (!d) throw new Error(`機器 ${g.device} がない`);
    cost += (d.price + linkCost(1)) * g.min;
  }
  if ((goalCount('server') > 0 || hasHttp) && byDevice.length === 0) {
    const server = cheapest('server', 1);
    if (!server) throw new Error('サーバーがない');
    cost += server.price + linkCost(1);
  }
  return cost;
};

// 案件の予算（切り上げた整数）。最安の設計の費用は、予算の 1 / margin になる
export const budgetOf = (template: ContractTemplate, map: GameMap, placed: readonly Pt[], furniture: readonly Pt[]): number =>
  Math.ceil(optimalCostOf(template, map, placed, furniture) * template.budget.margin);

// 台数が収まる最も安いスイッチの ID（試験の想定の解答が使う）
export const cheapestSwitchId = (ports: number): string => {
  const d = cheapest('l2_switch', ports);
  if (!d) throw new Error(`${ports} 口のスイッチがない`);
  return d.id;
};
