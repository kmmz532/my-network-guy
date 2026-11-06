// 定型案件の予算が、模範の設計の費用に対して適切かを確かめる（N51a の 6 章）。
// 模範の設計: 各グループの PC を、その範囲の配線の中心に置いたスイッチ1台（台数が収まる最も安いもの）でつなぐ。
// 目標に count があれば、その機器を最も安い値段で足す。グループが複数のときは、ルーターか中継のスイッチで結ぶ。
// 合格の基準: 費用 ÷ 予算 が 0.65〜0.8（★3 が取れ、余裕がありすぎない）。
import { describe, expect, it } from 'vitest';
import { cables, contractTemplates, devices } from 'virtual:game-data';
import type { ContractTemplate, Device, GameMap } from '../data/schema';
import officeSmall from '../assets/data/maps/office_small.json';
import officeTwoRooms from '../assets/data/maps/office_two_rooms.json';
import officeTwoSites from '../assets/data/maps/office_two_sites.json';
import schoolLab from '../assets/data/maps/school_lab.json';
import longHall from '../assets/data/maps/long_hall.json';
import factory from '../assets/data/maps/factory.json';
import cafeMap from '../assets/data/maps/cafe.json';
import clinicMap from '../assets/data/maps/clinic.json';
import libraryMap from '../assets/data/maps/library.json';
import coworkingMap from '../assets/data/maps/coworking.json';
import hotelFloorMap from '../assets/data/maps/hotel_floor.json';
import warehouseMap from '../assets/data/maps/warehouse.json';
import bankBranchMap from '../assets/data/maps/bank_branch.json';
import studioMap from '../assets/data/maps/studio.json';
import campusMap from '../assets/data/maps/campus.json';
import hospitalWardMap from '../assets/data/maps/hospital_ward.json';
import { instantiateTemplate, pcCountRangeOf, spawnGroupsOf, starHubOf } from './template';

const maps: Record<string, GameMap> = {
  office_small: officeSmall as unknown as GameMap,
  office_two_rooms: officeTwoRooms as unknown as GameMap,
  office_two_sites: officeTwoSites as unknown as GameMap,
  school_lab: schoolLab as unknown as GameMap,
  long_hall: longHall as unknown as GameMap,
  factory: factory as unknown as GameMap,
  cafe: cafeMap as unknown as GameMap,
  clinic: clinicMap as unknown as GameMap,
  library: libraryMap as unknown as GameMap,
  coworking: coworkingMap as unknown as GameMap,
  hotel_floor: hotelFloorMap as unknown as GameMap,
  warehouse: warehouseMap as unknown as GameMap,
  bank_branch: bankBranchMap as unknown as GameMap,
  studio: studioMap as unknown as GameMap,
  campus: campusMap as unknown as GameMap,
  hospital_ward: hospitalWardMap as unknown as GameMap,
};

const deviceList = Object.values(devices) as Device[];
const cheapest = (category: string, minPorts: number): Device | undefined =>
  deviceList
    .filter((d) => d.category === category && d.ports.reduce((s, p) => s + p.count, 0) >= minPorts)
    .sort((a, b) => a.price - b.price)[0];

type Pt = { x: number; y: number };
const dist = (a: Pt, b: Pt) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const utp = cables.utp_cat5e;
const fiber = cables.fiber_sm;
// 1本のケーブルの費用。UTP で届かない距離は光ファイバーにする
const linkCost = (d: number): number => {
  const c = d <= utp.maxLengthTiles ? utp : fiber;
  return c.pricePerLink + c.pricePerTile * d;
};

// 模範の設計の費用（機器と配線）。PC 自体は案件で置かれているため含めない
export const modelCost = (template: ContractTemplate, map: GameMap, placed: { x: number; y: number; ref: string }[]): number => {
  const goalCount = (category: string) =>
    template.goals.filter((g) => g.type === 'count' && g.category === category).reduce((s, g) => s + (g.type === 'count' ? g.min : 0), 0);
  const hasHttp = template.goals.some((g) => g.type === 'http_all' || g.type === 'http_from');
  // isolated の goals があるときは、互いに通信させない役割のグループを別のネットワークにする（つながりの組ごとに中継する）
  const isolatedRoles = new Set(template.goals.flatMap((g) => (g.type === 'isolated' ? g.from.map((r) => r.replace('$role:', '')) : [])));
  const groups = spawnGroupsOf(template);
  let cost = 0;
  // グループごとの PC の位置
  const pcsOf: Pt[][] = [];
  let k = 0;
  // グループは instantiate の並びの順（pc_1 から連番）
  const sizes = groups.map((g) => placed.filter((p) => p.x >= g.x && p.x < g.x + g.width && p.y >= g.y && p.y < g.y + g.height).length);
  k = 0;
  for (const n of sizes) {
    pcsOf.push(placed.slice(k, k + n));
    k += n;
  }
  const uplink = groups.length > 1 ? 1 : 0;
  const hubs: Pt[] = [];
  for (const pcs of pcsOf) {
    const need = pcs.length + uplink + (groups.length === 1 && goalCount('printer') > 0 ? 1 : 0);
    const hubDevice = goalCount('router_switch') > 0 && groups.length === 1 ? cheapest('router_switch', need) : cheapest('l2_switch', need);
    if (hubDevice) {
      cost += hubDevice.price;
    } else {
      // 1台に収まらないときは、最大のポート数のスイッチを複数使い、1本ずつ（1マス）でつなぐ
      const largest = deviceList.filter((d) => d.category === 'l2_switch').sort((a, b) => b.ports.reduce((s, p) => s + p.count, 0) - a.ports.reduce((s, p) => s + p.count, 0))[0];
      const ports = largest.ports.reduce((s, p) => s + p.count, 0);
      const k = Math.ceil(need / ports);
      cost += k * largest.price + (k - 1) * linkCost(1);
    }
    const hub = starHubOf(pcs, map);
    hubs.push({ x: hub.x, y: hub.y });
    for (const p of pcs) cost += linkCost(dist(p, hub));
  }
  // つなぐグループの組（isolated で分けた役割は別の組）
  const sets: Pt[][] = isolatedRoles.size
    ? [hubs.filter((_, i) => !isolatedRoles.has(groups[i].role ?? '')), hubs.filter((_, i) => isolatedRoles.has(groups[i].role ?? ''))].filter((x) => x.length > 0)
    : [hubs];
  for (const set of isolatedRoles.size ? sets : []) {
    if (set.length < 2) continue;
    const center = starHubOf(set.map((h) => ({ ...h, ref: '' })), map);
    if (set.length === 2 && dist(set[0], set[1]) <= utp.maxLengthTiles) cost += linkCost(dist(set[0], set[1]));
    else {
      cost += (cheapest('l2_switch', set.length)?.price ?? 0);
      for (const h of set) cost += linkCost(dist(h, center));
    }
  }
  if (groups.length > 1 && !isolatedRoles.size) {
    const center = starHubOf(hubs.map((h) => ({ ...h, ref: '' })), map);
    if (goalCount('firewall') > 0) {
      const fw = cheapest('firewall', groups.length + 1);
      if (!fw) throw new Error('ファイアウォールがない');
      cost += fw.price;
      for (const h of hubs) cost += linkCost(dist(h, center));
    } else if (goalCount('router') > 0) {
      const router = cheapest('router', groups.length);
      if (!router) throw new Error('ルーターがない');
      cost += router.price;
      for (const h of hubs) cost += linkCost(dist(h, center));
    } else {
      const direct = hubs.length === 2 && dist(hubs[0], hubs[1]) <= utp.maxLengthTiles;
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
  // プリンター（count printer）は、1台のスイッチに1本で足す
  if (goalCount('printer') > 0) {
    const printer = cheapest('printer', 1);
    if (!printer) throw new Error('プリンターがない');
    cost += printer.price + linkCost(1);
  }
  if (goalCount('server') > 0 || hasHttp) {
    const server = cheapest('server', 1);
    if (!server) throw new Error('サーバーがない');
    cost += server.price + linkCost(1);
  }
  return cost;
};

// 台数の最小・最大になる乱数の種を探し、そのときの案件を返す
const withCount = (template: ContractTemplate, map: GameMap, want: number) => {
  for (let seed = 1; seed <= 5000; seed++) {
    const { offer } = instantiateTemplate(template, map, 0, seed);
    if (offer.params.pcCount === want) return offer.contract;
  }
  throw new Error(`${template.id}: 台数 ${want} になる乱数が見つからない`);
};

const rows: { id: string; n: number; cost: number; budget: number; ratio: number; hub: number }[] = [];

describe.each(contractTemplates.map((t) => [t.id, t] as const))('模範の設計と予算 %s', (_id, template) => {
  const map = maps[template.map];
  it.each(['min', 'max'] as const)('台数の%s で、費用 ÷ 予算 が 0.65〜0.8 に入る', (which) => {
    const range = pcCountRangeOf(template);
    const n = which === 'min' ? range.min : range.max;
    const contract = withCount(template, map, n);
    const cost = modelCost(template, map, contract.placed);
    const hub = starHubOf(contract.placed, map);
    const budget = template.budget.base + template.budget.perPc * n + template.budget.perTile * hub.tiles;
    const ratio = cost / budget;
    rows.push({ id: template.id, n, cost, budget, ratio, hub: hub.tiles });
    expect(ratio).toBeGreaterThanOrEqual(0.65);
    expect(ratio).toBeLessThanOrEqual(0.8);
  });
});

describe('予算の表', () => {
  it('結果を表にして出す（調整のため）', () => {
    console.log(rows.map((r) => `${r.id}\t${r.n}\t${r.cost}\t${r.budget}\t${r.ratio.toFixed(3)}	${r.hub}`).join('\n'));
  });
});
