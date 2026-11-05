// タブの並びと、矢印キーなどで次に選ぶタブの決め方（画面の部品から切り離した純粋関数）。Tabs.tsx が使う
// 左右の矢印キーで隣のタブ（端では反対側へ回る）、Home と End で先頭と末尾を選ぶ。対象外のキーは null
export const nextTab = <T extends string>(list: readonly T[], current: T, key: string): T | null => {
  if (list.length === 0) return null;
  const i = list.indexOf(current);
  if (key === 'ArrowRight') return list[(i + 1) % list.length];
  if (key === 'ArrowLeft') return list[(i - 1 + list.length) % list.length];
  if (key === 'Home') return list[0];
  if (key === 'End') return list[list.length - 1];
  return null;
};
