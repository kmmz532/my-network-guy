// 自社オフィスの家具と社員の規則（純粋関数）。配置と撤去、社員の席の数と雇用を扱う。
import type { Balance, GameMap, Staff } from '../data/schema';
import { DESK_ID, emptyOffice, officeLocked, type Core, type Office, type Outcome } from './project';

const fail = (reason: string): Outcome => ({ ok: false, reason });

// 自社オフィスの初期状態。バランス値の初期の机の位置に、机を置く
export const initialOffice = (balance: Balance): Office => {
  const furniture = balance.staff.initialDesks.map((p, i) => ({ uid: `f${i}`, id: DESK_ID, x: p.x, y: p.y }));
  return { ...emptyOffice(), furniture, furnitureSeq: furniture.length };
};

// 自社オフィスの家具を置く。在庫があり、家具のない床のマスで、機材もないときだけ置ける
export const placeFurniture = (core: Core, id: string, x: number, y: number, map: GameMap): Outcome => {
  if (officeLocked(core)) return fail('inhouse');
  if ((core.owned[id] ?? 0) < 1) return fail('stock');
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return fail('tile');
  if (map.legend[map.tiles[y][x]] !== 'floor') return fail('tile');
  const office = core.office;
  if (office.furniture.some((f) => f.x === x && f.y === y)) return fail('tile');
  if (office.nodes.some((n) => n.x === x && n.y === y)) return fail('tile');
  return {
    ok: true,
    core: {
      ...core,
      office: {
        ...office,
        furniture: [...office.furniture, { uid: `f${office.furnitureSeq}`, id, x, y }],
        furnitureSeq: office.furnitureSeq + 1,
      },
      owned: { ...core.owned, [id]: core.owned[id] - 1 },
    },
  };
};

// 自社オフィスの家具を撤去する（在庫に戻る）。机の上にPCがあるときは撤去できない
export const removeFurniture = (core: Core, uid: string): Outcome => {
  if (officeLocked(core)) return fail('inhouse');
  const target = core.office.furniture.find((f) => f.uid === uid);
  if (!target) return fail('none');
  if (core.office.nodes.some((n) => n.x === target.x && n.y === target.y)) return fail('occupied');
  return {
    ok: true,
    core: {
      ...core,
      office: { ...core.office, furniture: core.office.furniture.filter((f) => f.uid !== uid) },
      owned: { ...core.owned, [target.id]: (core.owned[target.id] ?? 0) + 1 },
    },
  };
};

// 社員の席の数（席になる家具の数）。isSeat は家具IDが席かどうかを返す
export const seatCount = (office: Office, isSeat: (id: string) => boolean): number =>
  office.furniture.filter((f) => isSeat(f.id)).length;

// 社員を1人雇う。席の数を超えては雇えない。雇用に費用はかからない
export const hire = (core: Core, isSeat: (id: string) => boolean, staff: Staff): Outcome => {
  if (core.staff.length >= seatCount(core.office, isSeat)) return fail('seat');
  return { ok: true, core: { ...core, staff: [...core.staff, staff], staffSeq: core.staffSeq + 1 } };
};
