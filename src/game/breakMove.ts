// 休憩の動き（N42）。休憩が始まると机から休憩の場所（コーヒー・水・ソファなど）へ歩き、休憩が終わると机へ戻る。
// 見た目だけの動き。施工の進み・経験値・給与には関係しない（休憩中も机にいるものとして数える）。
import { walkPath, type Point } from './commute';

export type BreakMove =
  // 机にいる
  | { phase: 'desk'; at: Point; path: Point[] }
  // 休憩の場所へ歩いている
  | { phase: 'going'; at: Point; path: Point[] }
  // 休憩の場所にいる（使っている）
  | { phase: 'resting'; at: Point; path: Point[] }
  // 机へ戻っている
  | { phase: 'returning'; at: Point; path: Point[] };

export const deskMove = (desk: Point): BreakMove => ({ phase: 'desk', at: { ...desk }, path: [] });

// 1ステップ進める。onBreak は今が休憩の時間か。spot は休憩の場所、desk は机。route は床だけを通る経路（行けなければ null）
export const breakMoveStep = (
  m: BreakMove,
  dtMs: number,
  onBreak: boolean,
  desk: Point,
  spot: Point,
  route: (from: Point, to: Point) => Point[] | null,
): BreakMove => {
  // 休憩の終わりに、今いる場所から机へ戻る（行けなければ、その場で机に戻したことにする）
  const back = (at: Point): BreakMove => {
    const path = route(at, desk);
    if (path === null || path.length === 0) return deskMove(desk);
    return { phase: 'returning', at: { ...at }, path };
  };
  if (m.phase === 'desk') {
    if (!onBreak) return m;
    const path = route(desk, spot);
    if (path === null) return m;
    return path.length === 0 ? { phase: 'resting', at: { ...spot }, path: [] } : { phase: 'going', at: { ...desk }, path };
  }
  if (m.phase === 'going' || m.phase === 'returning') {
    const walked = walkPath(m.at, m.path, dtMs);
    if (walked.path.length > 0) return { phase: m.phase, at: walked.at, path: walked.path };
    // 着いた。休憩の途中なら、休憩の場所にいる。休憩が終わっていたら、机へ戻る
    if (m.phase === 'returning') return deskMove(desk);
    return onBreak ? { phase: 'resting', at: { ...spot }, path: [] } : back(spot);
  }
  // 休憩の場所にいる。休憩が終わったら机へ戻る
  return onBreak ? m : back(spot);
};
