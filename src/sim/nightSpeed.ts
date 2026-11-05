// 勤務時間外に施工中の案件があるとき、時間の速さを自動で最速にする判定。純粋関数で書く。
// 元の速さは saved に覚え、勤務時間になるか施工が終わったら戻す（プレイヤーが速さを変えたら、呼び出し側が saved を消す）。

export interface NightSpeedInput {
  // 勤務時間内か
  working: boolean;
  // 施工中の案件があるか
  building: boolean;
  // 現在の速さ（0 は停止）
  speed: number;
  // 自動で変える前の速さ（自動で変えていなければ null）
  saved: number | null;
  // 自動で変えるときの速さ（最速）
  fastest: number;
}

export interface NightSpeedState {
  speed: number;
  saved: number | null;
}

export const nightSpeedStep = (input: NightSpeedInput): NightSpeedState => {
  const { working, building, speed, saved, fastest } = input;
  const fast = !working && building;
  if (fast && saved === null && speed !== 0 && speed !== fastest) return { speed: fastest, saved: speed };
  if (!fast && saved !== null) return { speed: saved, saved: null };
  return { speed, saved };
};
