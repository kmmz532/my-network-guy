// シーケンス図の再生の進み方（純粋関数）。選んでいる行の次の行を返す。最後の行を過ぎたら null（再生を止める）。
export const nextPlayIndex = (current: number | null, count: number): number | null => {
  const next = current === null ? 0 : current + 1;
  return next < count ? next : null;
};
