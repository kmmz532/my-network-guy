// 登録にない機器・ケーブル・家具を、読み込んだセーブから取り除く（純粋な関数）。
// 取り除くのは、ID を持つ次の項目の、未知の要素だけ。
//   - 社内と各案件の機器（nodes）と、その機器につながる配線（links）。登録にないケーブルの配線も外す
//   - 社内の家具（furniture）
//   - 在庫（owned。機器と家具の ID が入る）
//   - 型紙（familiarity.blueprints）の機器と配線
//   - 依頼（offers）と案件（active）の契約の、配置する機器（contract.placed）
// 既知だけのセーブは、同じ参照を返す。
import type { NetLink, NetNode } from '../network/types';
import type { Company } from '../company/company';
import type { Office } from '../sim/project';
import { registries } from '../registry/game';

export interface DropResult {
  data: Company;
  // 取り除いた未知の機器・ケーブル・家具の ID（重複なし）
  dropped: string[];
  // 取り除いた数（機器の数・配置する機器の数・在庫の個数・ケーブルの配線の数・家具の数の合計）
  count: number;
}

interface Net {
  nodes: NetNode[];
  links: NetLink[];
}

interface Placed {
  placed: { device: string }[];
}

// 機器が登録にあるか。登録にない ID は取り除く
const isKnown = (device: string): boolean => registries.devices.has(device);

const isKnownCable = (cable: string): boolean => registries.cables.has(cable);
const isKnownFurniture = (id: string): boolean => registries.furniture.has(id);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

// 機器の網から、未知の機器と未知のケーブルの配線を取り除く。配線は、取り除いた機器につながるものも外す。変わらなければ同じ参照
const dropFromNet = <T extends Net>(net: T, ids: Set<string>): { net: T; count: number } => {
  const removed = net.nodes.filter((n) => !isKnown(n.device));
  const gone = new Set(removed.map((n) => n.uid));
  const unknownCables = net.links.filter((l) => !isKnownCable(l.cable));
  if (removed.length === 0 && unknownCables.length === 0) return { net, count: 0 };
  for (const n of removed) ids.add(n.device);
  for (const l of unknownCables) ids.add(l.cable);
  const links = net.links.filter((l) => isKnownCable(l.cable) && !gone.has(l.a.node) && !gone.has(l.b.node));
  const cableOnly = unknownCables.filter((l) => !gone.has(l.a.node) && !gone.has(l.b.node)).length;
  return { net: { ...net, nodes: net.nodes.filter((n) => isKnown(n.device)), links }, count: removed.length + cableOnly };
};

// 社内の家具から未知の家具を取り除く。変わらなければ同じ参照
const dropFurniture = (office: Office, ids: Set<string>): { office: Office; count: number } => {
  const removed = office.furniture.filter((f) => !isKnownFurniture(f.id));
  if (removed.length === 0) return { office, count: 0 };
  for (const f of removed) ids.add(f.id);
  return { office: { ...office, furniture: office.furniture.filter((f) => isKnownFurniture(f.id)) }, count: removed.length };
};

// 社内の構成から、未知の機器・ケーブル・家具を取り除く（構成のファイルの読み込みにも使う）
export const dropUnknownFromOffice = (input: Office): { office: Office; dropped: string[]; count: number } => {
  const ids = new Set<string>();
  const net = dropFromNet(input, ids);
  const furniture = dropFurniture(net.net, ids);
  return { office: furniture.office, dropped: [...ids], count: net.count + furniture.count };
};

// 契約の配置する機器から、未知の機器を取り除く。変わらなければ同じ参照
const dropPlaced = <T extends Placed>(contract: T, ids: Set<string>): { contract: T; count: number } => {
  const removed = contract.placed.filter((p) => !isKnown(p.device));
  if (removed.length === 0) return { contract, count: 0 };
  for (const p of removed) ids.add(p.device);
  return { contract: { ...contract, placed: contract.placed.filter((p) => isKnown(p.device)) }, count: removed.length };
};

// 依頼の契約（offers の要素の contract）から、未知の機器を取り除く
const dropOffer = (offer: unknown, ids: Set<string>): { offer: unknown; count: number } => {
  if (!isObject(offer) || !isObject(offer.contract) || !Array.isArray(offer.contract.placed)) return { offer, count: 0 };
  const r = dropPlaced(offer.contract as unknown as Placed, ids);
  if (r.count === 0) return { offer, count: 0 };
  return { offer: { ...offer, contract: r.contract }, count: r.count };
};

export const dropUnknownDevices = (data: Company): DropResult => {
  const ids = new Set<string>();
  let count = 0;
  let changed = false;

  // 社内の機器
  const office = dropUnknownFromOffice(data.office);
  for (const id of office.dropped) ids.add(id);
  count += office.count;

  // 各案件の機器と、案件の契約の配置する機器
  const active = data.active.map((p) => {
    const net = dropFromNet(p, ids);
    const contract = dropPlaced(p.contract as unknown as Placed, ids);
    count += net.count + contract.count;
    if (net.count === 0 && contract.count === 0) return p;
    return { ...net.net, contract: contract.contract as unknown as typeof p.contract };
  });
  if (active.some((p, i) => p !== data.active[i])) changed = true;

  // 在庫（機器と家具）
  const owned: Record<string, number> = {};
  let ownedChanged = false;
  for (const [id, n] of Object.entries(data.owned)) {
    if (isKnown(id) || isKnownFurniture(id)) {
      owned[id] = n;
      continue;
    }

    ownedChanged = true;
    ids.add(id);
    count += n;
  }

  // 型紙の機器と配線
  let blueprints = data.familiarity.blueprints;
  let blueprintsChanged = false;
  const nextBlueprints: typeof blueprints = {};
  for (const [key, bp] of Object.entries(blueprints)) {
    const r = dropFromNet(bp.design, ids);
    count += r.count;
    if (r.count === 0) {
      nextBlueprints[key] = bp;
      continue;
    }
    
    blueprintsChanged = true;
    nextBlueprints[key] = { ...bp, design: r.net };
  }
  if (blueprintsChanged) blueprints = nextBlueprints;

  // 依頼の契約の配置する機器
  let offersChanged = false;
  const offers = data.offers.map((o) => {
    const r = dropOffer(o, ids);
    count += r.count;
    if (r.count > 0) offersChanged = true;
    return r.offer;
  });

  if (office.office !== data.office) changed = true;
  if (ownedChanged || blueprintsChanged || offersChanged) changed = true;
  if (!changed) return { data, dropped: [], count: 0 };
  return {
    data: { ...data, office: office.office, active, owned, familiarity: { ...data.familiarity, blueprints }, offers: offers as Company['offers'] },
    dropped: [...ids],
    count,
  };
};
