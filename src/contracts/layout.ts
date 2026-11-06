// 依頼先のオフィスの配置（N76）。PC の机を、島・壁沿い・窓口の型で並べ、残りの床に家具を飾る。純粋な関数で、同じ乱数の状態からは同じ配置になる。
import type { GameMap } from '../data/schema';
import { tileKind } from '../data/tileKind';
import { rand, randInt } from '../sim/rng';

export type LayoutKind = 'island' | 'wall' | 'reception';

export interface Cell { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }
export interface FurnitureCell extends Cell { id: string }

// 飾りの家具の数は、床の広さに対するこの割合（5〜10%）
export const DECOR_RATIO = { min: 0.05, max: 0.1 };
// 飾りの既定の候補（事務所向け）。ひな形の decor で上書きする
export const DEFAULT_DECOR = ['plant', 'trash', 'cabinet', 'bookshelf', 'water'];
// 型の既定（島型と壁沿い型）。ひな形の layout で上書きする
export const DEFAULT_LAYOUT: LayoutKind[] = ['island', 'wall'];
// 型と位置を変えながら試す回数。これを超えたら作れないとして止める（予備の配置は作らない）
const MAX_TRIES = 40;

const NEIGHBOURS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const key = (x: number, y: number): string => `${x},${y}`;
const inRect = (r: Rect, x: number, y: number): boolean => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
const isFloor = (map: GameMap, x: number, y: number): boolean => tileKind(map, x, y) === 'floor';

// 机の島（2列 × 4行 = 最大8台）を、通路1マスを空けて並べた候補。先頭の島から行ごとに並ぶ
const islandSlots = (rect: Rect, ox: number, oy: number): Cell[] => {
  const out: Cell[] = [];
  for (let j = 0; j < rect.height; j++) {
    for (let i = 0; i < rect.width; i++) {
      const bx = rect.x + ox + 3 * i;
      const by = rect.y + oy + 5 * j;
      for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) out.push({ x: bx + c, y: by + r });
    }
  }
  return out;
};

// 壁沿いの1列（机の間を1マス空ける）
const wallRow = (rect: Rect, y: number, ox: number, n: number): Cell[] => {
  const out: Cell[] = [];
  for (let i = 0; i < n; i++) out.push({ x: rect.x + ox + 2 * i, y });
  return out;
};

interface Plan { slots: Cell[]; shelfRow: boolean; rng: number }

// 型ごとの候補の並び（先頭から順に使う）。範囲の外や床でないマスは、あとで外す。窓口型は、手前の行に机を並べ、後ろの行に棚を置く
const planOf = (kind: LayoutKind, map: GameMap, rect: Rect, rng: number): Plan => {
  let state = rng;
  const pick = (min: number, max: number): number => {
    const r = randInt(state, min, max);
    state = r.state;
    return r.value;
  };
  if (kind === 'island') {
    const ox = pick(0, Math.max(0, rect.width - 3));
    const oy = pick(0, Math.max(0, rect.height - 4));
    return { slots: islandSlots(rect, ox, oy), shelfRow: false, rng: state };
  }
  if (kind === 'wall') {
    // 窓のある壁を優先する。窓がなければ、上と下のどちらかを乱数で選ぶ
    const windowAt = (y: number): boolean => Array.from({ length: rect.width }, (_, i) => tileKind(map, rect.x + i, y) === 'window').some(Boolean);
    const topWindow = windowAt(rect.y - 1);
    const bottomWindow = windowAt(rect.y + rect.height);
    const useTop = topWindow !== bottomWindow ? topWindow : pick(0, 1) === 0;
    const y = useTop ? rect.y : rect.y + rect.height - 1;
    const ox = pick(0, 1);
    return { slots: wallRow(rect, y, ox, rect.width), shelfRow: false, rng: state };
  }
  // 窓口型: 下の行に机を並べ、上の行に同じ x の棚を置く
  const ox = pick(0, 1);
  return { slots: wallRow(rect, rect.y + rect.height - 1, ox, rect.width), shelfRow: true, rng: state };
};

export interface LaidOut {
  desks: Cell[];
  shelves: Cell[];
  rng: number;
}

// 範囲 rect に n 台の机を並べる。型と位置を乱数で変えながら試し、全部の机へ床を通って行ける配置を返す。作れなければ laid は null（rng は進んだ値）
export const layoutDesks = (
  map: GameMap,
  rect: Rect,
  n: number,
  kinds: readonly LayoutKind[],
  taken: ReadonlySet<string>,
  desksSoFar: readonly Cell[],
  rngState: number,
): { laid: LaidOut | null; rng: number } => {
  let rng = rngState;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const r = randInt(rng, 0, kinds.length - 1);
    rng = r.state;
    const plan = planOf(kinds[r.value], map, rect, rng);
    rng = plan.rng;
    // 使えるマスを先頭から取る。地図の柱・家具・壁のマスは飛ばす
    const free = (c: Cell): boolean => inRect(rect, c.x, c.y) && isFloor(map, c.x, c.y) && !taken.has(key(c.x, c.y));
    const desks = plan.slots.filter(free).slice(0, n);
    if (desks.length < n) continue;
    // 窓口型の棚は、机の真上（範囲の上の行）に置く。置けなければこの候補は使わない
    const shelves = plan.shelfRow ? desks.map((d) => ({ x: d.x, y: rect.y })) : [];
    if (!shelves.every((c) => free(c) && !desks.some((d) => d.x === c.x && d.y === c.y))) continue;
    const blocked = new Set([...taken, ...shelves.map((s) => key(s.x, s.y))]);
    if (!deskReachable(map, blocked, [...desksSoFar, ...desks])) continue;
    return { laid: { desks, shelves, rng }, rng };
  }
  return { laid: null, rng };
};

// 地図の床のつながり（壁で区切られた部屋ごとの番号）。部屋が別々なら、机が床でつながらなくてもよい
const componentCache = new WeakMap<GameMap, Map<string, number>>();
const componentsOf = (map: GameMap): Map<string, number> => {
  const cached = componentCache.get(map);
  if (cached) return cached;
  const id = new Map<string, number>();
  let next = 0;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!isFloor(map, x, y) || id.has(key(x, y))) continue;
      const stack: Cell[] = [{ x, y }];
      id.set(key(x, y), next);
      while (stack.length > 0) {
        const cur = stack.pop() as Cell;
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = cur.x + dx;
          const ny = cur.y + dy;
          if (isFloor(map, nx, ny) && !id.has(key(nx, ny))) {
            id.set(key(nx, ny), next);
            stack.push({ x: nx, y: ny });
          }
        }
      }
      next++;
    }
  }
  componentCache.set(map, id);
  return id;
};

// 同じ床のつながりにある机が、通路（床）を通って互いに行けるか。机の周りに1マス以上の床が必要
export const deskReachable = (map: GameMap, blocked: ReadonlySet<string>, desks: readonly Cell[]): boolean => {
  if (desks.length === 0) return true;
  const deskKeys = new Set(desks.map((d) => key(d.x, d.y)));
  const free = (x: number, y: number): boolean => isFloor(map, x, y) && !blocked.has(key(x, y)) && !deskKeys.has(key(x, y));
  const components = componentsOf(map);
  const byComponent = new Map<number, Cell[]>();
  for (const d of desks) {
    const c = components.get(key(d.x, d.y)) ?? -1;
    byComponent.set(c, [...(byComponent.get(c) ?? []), d]);
  }
  for (const group of byComponent.values()) {
    const seen = new Set<string>();
    const queue: Cell[] = [];
    for (const [dx, dy] of NEIGHBOURS) {
      const x = group[0].x + dx;
      const y = group[0].y + dy;
      if (free(x, y) && !seen.has(key(x, y))) {
        seen.add(key(x, y));
        queue.push({ x, y });
      }
    }
    while (queue.length > 0) {
      const cur = queue.shift() as Cell;
      for (const [dx, dy] of NEIGHBOURS) {
        const x = cur.x + dx;
        const y = cur.y + dy;
        if (free(x, y) && !seen.has(key(x, y))) {
          seen.add(key(x, y));
          queue.push({ x, y });
        }
      }
    }
    if (!group.every((d) => NEIGHBOURS.some(([dx, dy]) => seen.has(key(d.x + dx, d.y + dy))))) return false;
  }
  return true;
};

// 飾りの家具を、床の残りに置く。机の周りの1マスと、PC を置く範囲の中には置かない。壁際を優先し、置いたあとも全部の机へ行けることを確かめる
export const placeDecor = (
  map: GameMap,
  blocked: ReadonlySet<string>,
  desks: readonly Cell[],
  avoid: readonly Rect[],
  decor: readonly string[],
  rngState: number,
): { furniture: FurnitureCell[]; rng: number } => {
  let rng = rngState;
  const deskKeys = new Set(desks.map((d) => key(d.x, d.y)));
  let floorCount = 0;
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (isFloor(map, x, y)) floorCount++;
  const ratio = rand(rng);
  rng = ratio.state;
  const target = Math.round(floorCount * (DECOR_RATIO.min + (DECOR_RATIO.max - DECOR_RATIO.min) * ratio.value));

  const nearDesk = (x: number, y: number): boolean => deskKeys.has(key(x, y)) || NEIGHBOURS.some(([dx, dy]) => deskKeys.has(key(x + dx, y + dy)));
  const candidates: { x: number; y: number; score: number; tie: number }[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!isFloor(map, x, y) || blocked.has(key(x, y)) || nearDesk(x, y)) continue;
      if (avoid.some((r) => inRect(r, x, y))) continue;
      // 壁に接する数（壁際と角を優先する）
      const score = NEIGHBOURS.filter(([dx, dy]) => !isFloor(map, x + dx, y + dy)).length;
      const t = rand(rng);
      rng = t.state;
      candidates.push({ x, y, score, tie: t.value });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.tie - b.tie);

  const now = new Set(blocked);
  const furniture: FurnitureCell[] = [];
  for (const c of candidates) {
    if (furniture.length >= target) break;
    now.add(key(c.x, c.y));
    if (!deskReachable(map, now, desks)) {
      now.delete(key(c.x, c.y));
      continue;
    }
    const pick = randInt(rng, 0, decor.length - 1);
    rng = pick.state;
    furniture.push({ id: decor[pick.value], x: c.x, y: c.y });
  }
  return { furniture, rng };
};

export interface MapFurniture { id: string; x: number; y: number }

// 地図と依頼に置かれた家具（地図の固定の家具と、依頼で作った家具）。機器の置き場所の判定と描画で使う
export const furnitureOf = (
  mapFurniture: readonly MapFurniture[] | undefined,
  contractFurniture: readonly MapFurniture[] | undefined,
): { uid: string; id: string; x: number; y: number }[] => [
  ...(mapFurniture ?? []).map((f, i) => ({ uid: `m${i}`, id: f.id, x: f.x, y: f.y })),
  ...(contractFurniture ?? []).map((f, i) => ({ uid: `c${i}`, id: f.id, x: f.x, y: f.y })),
];
