// 自社オフィスの社員の動き（出勤・退勤・休憩・歩き回り）の状態と更新。描画は Scene が行い、ここの状態を読む。
// 位置は保存しない。時間の進みは Scene が渡す（ゲームの速度を掛けたもの）。
import { balance } from 'virtual:game-data';
import type { GameMap } from '../data/schema';
import { tileKind } from '../data/tileKind';
import { minutesPerDay as dayMinutes } from '../sim/clock';
import { breakAt, breakPlanOf } from '../sim/breaks';
import { gameEnv } from '../sim/env';
import { seatedStaff, unseatedStaff } from '../sim/furniture';
import { isDeskFurniture } from '../sim/project';
import { isPresentOnShift, minuteInShift } from '../sim/shift';
import { focusedProject, useGameStore } from '../stores/useGameStore';
import type { Point } from './animation';
import { breakMoveStep, deskMove, type BreakMove } from './breakMove';
import { bfsRoute, commuteStep, walkPath, type Commute } from './commute';
import { deskStaffPos, deskTap, wanderStaffPos, type StaffHit } from './staffHit';
import { routeFrom, wanderStep, type Walker } from './wander';

// 席になる家具（机）かどうか（社員が座る）
export const isDesk = (id: string): boolean => isDeskFurniture(id, gameEnv);

// 出勤・退勤で1フレームに歩かせる時間の上限（ms）
const COMMUTE_MAX_FRAME_MS = 100;
// 休憩の場所にする家具（自社オフィス）
const BREAK_FURNITURE = ['coffee', 'water', 'sofa'];

// 社員が集まるマス。床のうち家具のないマスを、部屋の中央に近い順に並べる
export const gatherSpotsOf = (floor: readonly Point[], furniture: ReadonlySet<string>): Point[] => {
  if (floor.length === 0) throw new Error('集まる床がない');
  const cx = (Math.min(...floor.map((p) => p.x)) + Math.max(...floor.map((p) => p.x))) / 2;
  const cy = (Math.min(...floor.map((p) => p.y)) + Math.max(...floor.map((p) => p.y))) / 2;
  const free = floor.filter((p) => !furniture.has(`${p.x},${p.y}`));
  return (free.length > 0 ? free : [...floor]).sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
};

export class OfficeStaffMotion {
  // 席のない社員（自社オフィスを歩き回る）
  walkers: Walker[] = [];
  // 机の社員の出勤・退勤の状態（キーは社員の uid）
  private commutes = new Map<string, Commute>();
  // エンディングで歩き手が向かっているマス（キーは歩き手の番号）
  private gatherTargets = new Map<number, Point>();
  // 休憩の動き（キーは社員の uid。机にいる社員は desk）
  private breaks = new Map<string, BreakMove>();

  commuteOf(uid: string): Commute | undefined {
    return this.commutes.get(uid);
  }

  breakOf(uid: string): BreakMove | undefined {
    return this.breaks.get(uid);
  }

  // 時間（dt ms）だけ進める。自社オフィス（hq）以外では歩き手を消す
  update(map: GameMap | null, dt: number): void {
    this.updateWalkers(map, dt);
    this.updateCommutes(map, dt);
  }

  // 自社オフィスに描いている社員の位置と uid。席の社員は席の順（雇用の順）、歩き回る社員は席の数の後の社員
  // 描いていないとき（納品の結果、施工中、ほかのマップ）は空
  hits(map: GameMap | null, elapsed: number, ts: number): StaffHit[] {
    const s = useGameStore.getState();
    if (map?.id !== 'hq' || s.showcase || focusedProject(s)?.phase === 'build') return [];
    const hits: StaffHit[] = [];
    seatedStaff(s.office, s.staff, isDesk).forEach(({ member, desk: f }, k) => {
      // 外にいる社員と、歩いている社員は、机の前にいないので選べない
      const c = this.commutes.get(member.uid);
      if (c && c.state !== 'seated') return;
      // 休憩の途中の社員は、机の前にいないので選べない
      const b = this.breaks.get(member.uid);
      if (b && b.phase !== 'desk') return;
      hits.push({ uid: member.uid, ...deskStaffPos(f.x, f.y, ts, deskTap(elapsed, k), f.facing ?? 'up') });
    });
    const unseated = unseatedStaff(s.office, s.staff, isDesk);
    this.walkers.forEach((w, k) => {
      const member = unseated[k];
      if (member) hits.push({ uid: member.uid, ...wanderStaffPos(w.x, w.y, ts) });
    });
    return hits;
  }

  // 机の社員の出勤と退勤。終業（workEndHour）になると机からドアへ歩いて外に出て、始業（workStartHour）になるとドアから机へ歩いて入る（自社オフィスのみ）
  private updateCommutes(map: GameMap | null, dt: number): void {
    if (!map || map.id !== 'hq') return;
    const s = useGameStore.getState();
    // 出社は始業の少し前から（席に着いているのは始業まで）。事務所にいる時刻の間は、出勤の途中か机にいる
    // 出入り口は、マップの最初のドアのマス。ドアがない最初の部屋では、下の壁の手前の中央の床を出入り口にする
    let door: Point = { x: Math.floor(map.width / 2), y: map.height - 2 };
    outer: for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (tileKind(map, x, y) === 'door') {
          door = { x, y };
          break outer;
        }
      }
    }
    const passable = (x: number, y: number): boolean => {
      const kind = tileKind(map, x, y);
      return kind === 'floor' || kind === 'door';
    };
    const route = (from: Point, to: Point): Point[] | null => bfsRoute(from, to, passable);
    const seated = seatedStaff(s.office, s.staff, isDesk);
    // 休憩の場所（コーヒー・水・ソファ）。なければ、床の数か所を歩き回る
    const restSpots = s.office.furniture.filter((f) => BREAK_FURNITURE.includes(f.id)).map((f): Point => ({ x: f.x, y: f.y }));
    const floor: Point[] = [];
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (tileKind(map, x, y) === 'floor') floor.push({ x, y });
    const minuteOfDay = s.clock.minute % dayMinutes;
    const day = Math.floor(s.clock.minute / dayMinutes);
    const frameDt = Math.min(dt, COMMUTE_MAX_FRAME_MS);
    // エンディングの間は、全社員が出社して、部屋の中央に集まる
    const gathering = s.ending === 'playing';
    const gatherSpots = gathering ? gatherSpotsOf(floor, new Set(s.office.furniture.map((f) => `${f.x},${f.y}`))) : [];
    const seen = new Set<string>();
    seated.forEach(({ member, desk: f }, k) => {
      seen.add(member.uid);
      // 出社と退社は、社員の勤務の区分（日勤・夜勤）で決まる（N48）
      const present = gathering || isPresentOnShift(minuteOfDay, member.shift, balance);
      const cur = this.commutes.get(member.uid) ?? { state: present ? 'seated' : 'away', at: { x: f.x, y: f.y }, path: [] };
      // 1フレームで進みすぎないよう、歩かせる時間を上限で抑える（フレームが飛んだときに一気に歩き終えない）
      const next = commuteStep(cur, frameDt, present, { x: f.x, y: f.y }, door, route);
      this.commutes.set(member.uid, next);
      // 休憩は、机にいる社員だけ。休憩の場所は、社員ごとに決まった場所（なければ床の決まった場所）
      const plan = breakPlanOf(member.uid, day, balance, member.shift);
      const onBreak = next.state === 'seated' && (gathering || breakAt(minuteInShift(minuteOfDay, member.shift, balance), plan) !== null);
      const spot = gathering
        ? gatherSpots[k % gatherSpots.length]
        : restSpots.length > 0
          ? restSpots[k % restSpots.length]
          : (floor[(k * 7) % Math.max(1, floor.length)] ?? { x: f.x, y: f.y });
      const prev = this.breaks.get(member.uid) ?? deskMove({ x: f.x, y: f.y });
      this.breaks.set(
        member.uid,
        next.state === 'seated' ? breakMoveStep(prev, frameDt, onBreak, { x: f.x, y: f.y }, spot, route) : deskMove({ x: f.x, y: f.y }),
      );
    });
    for (const uid of [...this.commutes.keys()]) if (!seen.has(uid)) this.commutes.delete(uid);
    for (const uid of [...this.breaks.keys()]) if (!seen.has(uid)) this.breaks.delete(uid);
  }

  // 席の数を超えた社員は、歩き回る。人数に合わせて歩き手を増減し、床の上を歩かせる（自社オフィスのみ）
  private updateWalkers(map: GameMap | null, dt: number): void {
    if (!map || map.id !== 'hq') {
      this.walkers = [];
      return;
    }
    const s = useGameStore.getState();
    const count = unseatedStaff(s.office, s.staff, isDesk).length;
    const floor: Point[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const kind = tileKind(map, x, y);
        if (kind === 'floor' || kind === 'door') floor.push({ x, y });
      }
    }
    while (this.walkers.length < count) {
      const start = floor.length ? floor[Math.floor(Math.random() * floor.length)] : { x: 0, y: 0 };
      this.walkers.push({ x: start.x, y: start.y, path: [], pause: 0 });
    }
    this.walkers.length = count;
    // エンディングの間は、席のない社員も、席のある社員の次の並びのマスへ歩いて集まる
    if (s.ending !== 'playing') {
      this.gatherTargets.clear();
      this.walkers = this.walkers.map((w) => wanderStep(w, dt, floor, Math.random));
      return;
    }
    const spots = gatherSpotsOf(floor.filter((p) => tileKind(map, p.x, p.y) === 'floor'), new Set(s.office.furniture.map((f) => `${f.x},${f.y}`)));
    const seated = seatedStaff(s.office, s.staff, isDesk).length;
    this.walkers = this.walkers.map((w, k) => {
      const spot = spots[(seated + k) % spots.length];
      const target = this.gatherTargets.get(k);
      const path = target?.x === spot.x && target.y === spot.y ? w.path : routeFrom({ x: Math.round(w.x), y: Math.round(w.y) }, spot);
      this.gatherTargets.set(k, spot);
      const walked = walkPath({ x: w.x, y: w.y }, path, Math.min(dt, COMMUTE_MAX_FRAME_MS));
      return { x: walked.at.x, y: walked.at.y, path: walked.path, pause: 0 };
    });
  }
}
