// 昼夜の画面の暗さ（0〜MAX_SHADE）。昼は明るく、夜は暗くする。やりすぎると見づらいので、最大でも MAX_SHADE にとどめる。
// 8時で明るくなり切り、17時から暗くなり始めて20時で暗くなり切る。6時から8時まで、夜の暗さから明るくなる。
export const MAX_SHADE = 0.3;

export const nightShade = (hour: number): number => {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 8 && h < 17) return 0;
  if (h >= 6 && h < 8) return (MAX_SHADE * (8 - h)) / 2;
  if (h >= 17 && h < 20) return (MAX_SHADE * (h - 17)) / 3;
  return MAX_SHADE;
};
