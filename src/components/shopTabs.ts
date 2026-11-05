// 機材ショップのタブの並びと、矢印キーで次に選ぶタブの決め方（画面の部品から切り離した純粋関数）
export type ShopSection = 'device' | 'furniture';

export const SHOP_SECTIONS: readonly ShopSection[] = ['device', 'furniture'];

// 左右の矢印キーで隣のタブ（端では反対側へ回る）、Home と End で先頭と末尾を選ぶ。対象外のキーは null
export const nextShopSection = (list: readonly ShopSection[], current: ShopSection, key: string): ShopSection | null => {
  const i = list.indexOf(current);
  if (key === 'ArrowRight') return list[(i + 1) % list.length];
  if (key === 'ArrowLeft') return list[(i - 1 + list.length) % list.length];
  if (key === 'Home') return list[0];
  if (key === 'End') return list[list.length - 1];
  return null;
};
