// 登録にない機器を、読み込んだセーブから取り除く（純粋な関数）。
// 取り除くのは、社内と各案件の機器（nodes）と、その機器につながる配線（links）、機材の在庫（owned）の未知の ID。
// 既知だけのセーブは、同じ参照を返す。
import type { NetLink, NetNode } from '../network/types';
import type { SaveData } from './migrations';
import { registries } from '../registry/game';

export interface DropResult {
  data: SaveData;
  // 取り除いた未知の機器の ID（重複なし）
  dropped: string[];
  // 取り除いた数（機器の数と、在庫の個数の合計）
  count: number;
}

interface Net {
  nodes: NetNode[];
  links: NetLink[];
}

// 機器が登録にあるか。登録にない ID は取り除く
const isKnown = (device: string): boolean => registries.devices.has(device);

// 1つの網から未知の機器を取り除く。配線は、取り除いた機器につながるものを外す
const dropFromNet = <T extends Net>(net: T, droppedIds: Set<string>): { net: T; count: number } => {
  const removed = net.nodes.filter((n) => !isKnown(n.device));
  if (removed.length === 0) return { net, count: 0 };
  for (const n of removed) droppedIds.add(n.device);
  const gone = new Set(removed.map((n) => n.uid));
  const links = net.links.filter((l) => !gone.has(l.a.node) && !gone.has(l.b.node));
  return { net: { ...net, nodes: net.nodes.filter((n) => isKnown(n.device)), links }, count: removed.length };
};

export const dropUnknownDevices = (data: SaveData): DropResult => {
  const droppedIds = new Set<string>();
  let count = 0;

  const office = dropFromNet(data.office, droppedIds);
  count += office.count;
  const active = data.active.map((p) => {
    const r = dropFromNet(p, droppedIds);
    count += r.count;
    return r.net;
  });

  const owned: Record<string, number> = {};
  let ownedChanged = false;
  for (const [id, n] of Object.entries(data.owned)) {
    if (isKnown(id)) {
      owned[id] = n;
    } else {
      ownedChanged = true;
      droppedIds.add(id);
      count += n;
    }
  }

  const changed = office.count > 0 || active.some((p, i) => p !== data.active[i]) || ownedChanged;
  if (!changed) return { data, dropped: [], count: 0 };
  return { data: { ...data, office: office.net, active, owned }, dropped: [...droppedIds], count };
};
