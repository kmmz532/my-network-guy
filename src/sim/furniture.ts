// 自社オフィスの家具と社員の規則（純粋関数）。配置と撤去、社員の席の数と雇用を扱う。
import type { Balance, Furniture, GameMap, Staff } from '../data/schema';
import { DESK_ID, emptyOffice, fail, isPcIn, officeLocked, type Core, type Env, type Office, type Outcome } from './project';
import { tileKind } from '../data/tileKind';
import type { NetLink, NetNode } from '../network/types';
import cablesData from '../assets/data/cables.json';
import { rotateFacing } from './facing';


// 自社オフィスの初期状態。バランス値の初期の大きさの部屋に、バランス値の初期の机の位置に机を置く
// 回線終端は最初は置かない。解放のレベルに届いてから、置き場所を選んで置く（placeOfficeUplink）
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
// 家具の上の機材は、家具と一緒に動く（機材が床に取り残されない・N103・N168）。動いた先のマスに、家具か機材があれば動かせない
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
  // 机の上の機器（PC など）は、机と一緒に動く（N103）。つながっているケーブルは、動いた機器からもう一方の機器まで道筋を引き直す
  const dx = x - target.x;
  const dy = y - target.y;
  const riding = new Set(office.nodes.filter((n) => n.x === target.x && n.y === target.y).map((n) => n.uid));
  const movedNode = (n: NetNode): { x: number; y: number } => (riding.has(n.uid) ? { x: n.x + dx, y: n.y + dy } : { x: n.x, y: n.y });
  const nodeAt = new Map(office.nodes.map((n) => [n.uid, movedNode(n)] as const));
  // 動いたあとの、置けないマス（机・機器。動かす机は新しい場所）
  const blocked = (px: number, py: number): boolean =>
    (px === x && py === y) ||
    office.furniture.some((f) => f.uid !== uid && f.x === px && f.y === py) ||
    office.nodes.some((n) => !riding.has(n.uid) && n.x === px && n.y === py);
  const links: NetLink[] = [];
  for (const l of office.links) {
    if (!riding.has(l.a.node) && !riding.has(l.b.node)) {
      links.push(l);
      continue;
    }
    const from = nodeAt.get(l.a.node);
    const to = nodeAt.get(l.b.node);
    if (!from || !to) return fail('linked');
    const path = routeFloor(map, from, to, blocked);
    if (path === null) return fail('tile');
    const max = cablesMaxTiles(l.cable);
    if (max !== undefined && path.length - 1 > max) return fail('cableTooLong');
    links.push({ ...l, path });
  }
  return {
    ok: true,
    core: {
      ...core,
      office: {
        ...office,
        furniture: office.furniture.map((f) => (f.uid === uid ? { ...f, x, y } : f)),
        nodes: office.nodes.map((n) => (riding.has(n.uid) ? { ...n, x: n.x + dx, y: n.y + dy } : n)),
        links,
      },
    },
  };
};

// 床の上の最短の道筋（4方向）。始点と終点を含む。通れない場所（blocked）と床でないマスは通らない。道がなければ null
const routeFloor = (map: GameMap, from: { x: number; y: number }, to: { x: number; y: number }, blocked: (x: number, y: number) => boolean): [number, number][] | null => {
  const key = (px: number, py: number) => `${px},${py}`;
  const prev = new Map<string, string | null>([[key(from.x, from.y), null]]);
  const queue: [number, number][] = [[from.x, from.y]];
  const goal = key(to.x, to.y);
  for (let i = 0; i < queue.length; i++) {
    const [cx, cy] = queue[i];
    if (key(cx, cy) === goal) break;
    for (const [dx2, dy2] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx2;
      const ny = cy + dy2;
      const k = key(nx, ny);
      if (prev.has(k)) continue;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      if (tileKind(map, nx, ny) !== 'floor') continue;
      if (k !== goal && blocked(nx, ny)) continue;
      prev.set(k, key(cx, cy));
      queue.push([nx, ny]);
    }
  }
  if (!prev.has(goal)) return null;
  const path: [number, number][] = [];
  for (let k: string | null | undefined = goal; k; k = prev.get(k)) {
    const [px, py] = k.split(',').map(Number);
    path.unshift([px, py]);
  }
  return path;
};

// ケーブルの種類の最大の長さ（マス）。種類がなければ undefined
const cablesMaxTiles = (cable: string): number | undefined => (cablesData.cables as { id: string; maxLengthTiles: number }[]).find((c) => c.id === cable)?.maxLengthTiles;

// 家具を90度回す（N95）。机の上の機器は机の向きに合わせて絵を変える（機器は向きを持たず、机と同じ向きで描く）
export const rotateFurniture = (core: Core, uid: string): Outcome => {
  if (officeLocked(core)) return fail('inhouse');
  const target = core.office.furniture.find((f) => f.uid === uid);
  if (!target) return fail('none');
  return {
    ok: true,
    core: {
      ...core,
      office: { ...core.office, furniture: core.office.furniture.map((f) => (f.uid === uid ? { ...f, facing: rotateFacing(f.facing ?? 'up') } : f)) },
    },
  };
};

// 自社オフィスの家具を撤去する（在庫に戻る）。机の上にPCがあるときは撤去できない
export const removeFurniture = (core: Core, uid: string): Outcome => {
  if (officeLocked(core)) return fail('inhouse');
  const target = core.office.furniture.find((f) => f.uid === uid);
  if (!target) return fail('none');
  if (core.office.nodes.some((n) => n.x === target.x && n.y === target.y)) return fail('occupied');
  // 社員が座っている机は撤去できない（座る席がなくなるため）
  if (core.staff.some((s) => s.desk === uid)) return fail('seated');
  return {
    ok: true,
    core: {
      ...core,
      office: { ...core.office, furniture: core.office.furniture.filter((f) => f.uid !== uid) },
      owned: { ...core.owned, [target.id]: (core.owned[target.id] ?? 0) + 1 },
    },
  };
};

// 候補の社員を採用する。席の数を超えては採用できない。採用に費用はかからない
export const hire = (core: Core, candidateUid: string, isSeat: (id: string) => boolean, staffCap: number, shift: 'day' | 'night'): Outcome => {
  const candidate = core.candidates.find((c) => c.uid === candidateUid);
  if (!candidate) return fail('none');
  // 空いている机（社員に座られていない席）がなければ採用できない
  const desk = freeDesks(core.office, core.staff, isSeat)[0];
  if (!desk) return fail('seat');
  // 会社のレベルの上限（人数）に達していれば採用できない（LEVEL.md 3.3）
  if (core.staff.length >= staffCap) return fail('cap');
  // 雇うときに、日勤か夜勤を選ぶ（夜勤は会社のレベルで解放される・N48）
  // 採用した月を覚える（退職の条件に使う）。候補は採用の時点で退職の予定はない
  const staff: Staff = { ...candidate, uid: `s${core.staffSeq}`, shift, desk: desk.uid, hiredMonth: core.clock.paidMonths, leaving: false };
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

// 社員が座る机の位置。desk は社員の机（家具の uid）。机がなければ null
export const seatOf = (office: Office, desk: string | null, defs: Record<string, Furniture>): { x: number; y: number } | null => {
  if (desk === null) return null;
  const f = office.furniture.find((x) => x.uid === desk);
  return f && defs[f.id]?.seat === true ? { x: f.x, y: f.y } : null;
};

// 机に座っている社員と、その机の家具（社員の机の順）。机のない社員は含まない
export const seatedStaff = <T extends { desk: string | null }>(office: Office, staff: readonly T[], isSeat: (id: string) => boolean): { member: T; desk: Office['furniture'][number] }[] =>
  staff.flatMap((member) => {
    const desk = member.desk === null ? undefined : office.furniture.find((f) => f.uid === member.desk && isSeat(f.id));
    return desk ? [{ member, desk }] : [];
  });

// 机のない社員（歩き回る社員）
export const unseatedStaff = <T extends { desk: string | null }>(office: Office, staff: readonly T[], isSeat: (id: string) => boolean): T[] => {
  const seated = new Set(seatedStaff(office, staff, isSeat).map((x) => x.member));
  return staff.filter((m) => !seated.has(m));
};

// 社員に座られていない机（並び順）。席になる家具のうち、どの社員の机でもないもの
export const freeDesks = (office: Office, staff: readonly { desk: string | null }[], isSeat: (id: string) => boolean): Office['furniture'] => {
  const taken = new Set(staff.map((s) => s.desk));
  return office.furniture.filter((f) => isSeat(f.id) && !taken.has(f.uid));
};

// 机のない社員に、空いている机を並び順に割り当てる（机のある社員は変えない）
export const assignDesks = <T extends { desk: string | null }>(staff: readonly T[], office: Office, isSeat: (id: string) => boolean): T[] => {
  const free = freeDesks(office, staff, isSeat).map((f) => f.uid);
  let next = 0;
  return staff.map((s) => (s.desk === null && next < free.length ? { ...s, desk: free[next++] } : s));
};

// 社員の家具の補正。power（施工力）・exp（経験値）は着席している社員だけに効く。seatless は席のない社員の係数
export interface StaffBonus {
  power: number;
  exp: number;
  seatless: number;
}

// 補正の計算に必要な情報。defs は家具IDから家具の定義、staff は社員（座っている机を持つ）
export interface BonusEnv {
  defs: Record<string, Furniture>;
  balance: Balance;
  staff: readonly { uid: string; desk: string | null }[];
  // PC（機器の種類が pc）が置かれている机（家具の uid）。PC の有無で社内の職種の働きが変わる（N102）
  pcDesks: readonly string[];
}

// PC が置かれている家具（机）の uid（N102）。isPc は機器の種類が PC かを返す
export const pcDesksOf = (office: Office, isPc: (device: string) => boolean): string[] =>
  office.furniture.filter((f) => office.nodes.some((n) => n.x === f.x && n.y === f.y && isPc(n.device))).map((f) => f.uid);

// 社員1人の家具の補正。机の位置から範囲（チェビシェフ距離）を測る。同じ家具IDは1つ分だけ数える
export const furnitureBonus = (office: Office, staffUid: string, env: BonusEnv): StaffBonus => {
  // 席のない社員の係数: ソファがあればその値、なければ既定の係数（効果は重ねない）
  const seatlessValues = office.furniture
    .map((f) => env.defs[f.id]?.effect)
    .filter((e) => e?.stat === 'seatless')
    .map((e) => e!.value);
  const seatless = seatlessValues.length > 0 ? Math.max(...seatlessValues) : env.balance.staff.power.seatless;

  const desk = seatOf(office, env.staff.find((s) => s.uid === staffUid)?.desk ?? null, env.defs);
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

// 社員の効果の計算に渡す環境を、自社オフィスと社員の一覧から作る（N116）。PC の判定は環境の機器の定義を使う
export const bonusEnvOf = (core: Pick<Core, 'staff' | 'office'>, env: Env): BonusEnv => ({
  defs: env.furniture ?? {},
  balance: env.balance,
  staff: core.staff,
  pcDesks: pcDesksOf(core.office, (d) => isPcIn(env, d)),
});
