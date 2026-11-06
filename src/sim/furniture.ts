// 自社オフィスの家具と社員の規則（純粋関数）。配置と撤去、社員の席の数と雇用を扱う。
import type { Balance, Furniture, GameMap, Staff } from '../data/schema';
import { DESK_ID, emptyOffice, officeLocked, type Core, type Office, type Outcome } from './project';
import { tileKind } from '../data/tileKind';

const fail = (reason: string): Outcome => ({ ok: false, reason });

// 自社オフィスの初期状態。バランス値の初期の大きさの部屋に、バランス値の初期の机の位置に机を置く
export const initialOffice = (balance: Balance): Office => {
  const furniture = balance.staff.initialDesks.map((p, i) => ({ uid: `f${i}`, id: DESK_ID, x: p.x, y: p.y }));
  return { ...emptyOffice(balance.office.initialSize), furniture, furnitureSeq: furniture.length };
};

// 自社オフィスの家具を置く。在庫があり、家具のない床のマスで、機材もないときだけ置ける
export const placeFurniture = (core: Core, id: string, x: number, y: number, map: GameMap): Outcome => {
  if (officeLocked(core)) return fail('inhouse');
  if ((core.owned[id] ?? 0) < 1) return fail('stock');
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return fail('tile');
  if (tileKind(map, x, y) !== 'floor') return fail('tile');
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

// 自社オフィスの家具を別のマスへ動かす。置ける条件は配置と同じ（床で、家具も機材もないマス）。
// 家具の上に機材があるときは動かせない（機材が床に取り残されるため）
export const moveFurniture = (core: Core, uid: string, x: number, y: number, map: GameMap): Outcome => {
  if (officeLocked(core)) return fail('inhouse');
  const office = core.office;
  const target = office.furniture.find((f) => f.uid === uid);
  if (!target) return fail('none');
  if (x === target.x && y === target.y) return { ok: true, core };
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return fail('tile');
  if (tileKind(map, x, y) !== 'floor') return fail('tile');
  if (office.furniture.some((f) => f.uid !== uid && f.x === x && f.y === y)) return fail('tile');
  if (office.nodes.some((n) => n.x === x && n.y === y)) return fail('tile');
  if (office.nodes.some((n) => n.x === target.x && n.y === target.y)) return fail('occupied');
  return {
    ok: true,
    core: {
      ...core,
      office: { ...office, furniture: office.furniture.map((f) => (f.uid === uid ? { ...f, x, y } : f)) },
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

// 候補の社員を採用する。席の数を超えては採用できない。採用に費用はかからない
export const hire = (core: Core, candidateUid: string, isSeat: (id: string) => boolean, staffCap: number, shift: 'day' | 'night'): Outcome => {
  const candidate = core.candidates.find((c) => c.uid === candidateUid);
  if (!candidate) return fail('none');
  if (core.staff.length >= seatCount(core.office, isSeat)) return fail('seat');
  // 会社のレベルの上限（人数）に達していれば採用できない（LEVEL.md 3.3）
  if (core.staff.length >= staffCap) return fail('cap');
  // 雇うときに、日勤か夜勤を選ぶ（夜勤は会社のレベルで解放される・N48）
  const staff: Staff = { ...candidate, uid: `s${core.staffSeq}`, shift };
  return {
    ok: true,
    core: {
      ...core,
      staff: [...core.staff, staff],
      staffSeq: core.staffSeq + 1,
      candidates: core.candidates.filter((c) => c.uid !== candidateUid),
    },
  };
};

// 社員が座る机（雇用の順に、並び順の机から1つずつ）。席がなければ null
export const seatOf = (
  office: Office,
  staffUids: readonly string[],
  uid: string,
  defs: Record<string, Furniture>,
): { x: number; y: number } | null => {
  const desks = office.furniture.filter((f) => defs[f.id]?.seat === true);
  const index = staffUids.indexOf(uid);
  return index >= 0 && index < desks.length ? desks[index] : null;
};

// 社員の家具の補正。power（施工力）・exp（経験値）は着席している社員だけに効く。seatless は席のない社員の係数
export interface StaffBonus {
  power: number;
  exp: number;
  seatless: number;
}

// 補正の計算に必要な情報。defs は家具IDから家具の定義、staffUids は雇用の順（先頭から机に座る）
export interface BonusEnv {
  defs: Record<string, Furniture>;
  balance: Balance;
  staffUids: readonly string[];
}

// 社員1人の家具の補正。机の位置から範囲（チェビシェフ距離）を測る。同じ家具IDは1つ分だけ数える
export const furnitureBonus = (office: Office, staffUid: string, env: BonusEnv): StaffBonus => {
  // 席のない社員の係数: ソファがあればその値、なければ既定の係数（効果は重ねない）
  const seatlessValues = office.furniture
    .map((f) => env.defs[f.id]?.effect)
    .filter((e) => e?.stat === 'seatless')
    .map((e) => e!.value);
  const seatless = seatlessValues.length > 0 ? Math.max(...seatlessValues) : env.balance.staff.power.seatless;

  const desk = seatOf(office, env.staffUids, staffUid, env.defs);
  if (!desk) return { power: 0, exp: 0, seatless };

  let power = 0;
  let exp = 0;
  const counted = new Set<string>();
  for (const f of office.furniture) {
    const effect = env.defs[f.id]?.effect;
    if (!effect || effect.stat === 'seatless' || counted.has(f.id)) continue;
    const inRange =
      effect.range === undefined || Math.max(Math.abs(f.x - desk.x), Math.abs(f.y - desk.y)) <= effect.range;
    if (!inRange) continue;
    counted.add(f.id);
    if (effect.stat === 'power') power += effect.value;
    else exp += effect.value;
  }
  return { power, exp, seatless };
};
