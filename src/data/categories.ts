// 機器の分類（category）の名前の一覧。機器の定義（devices/*.json）・判定・表示の全部がこの値を使う（R4）。
// 文字列を直接書くと、綴りの誤りが検出されないため、ここから参照する。
export const CATEGORY = {
  pc: 'pc',
  server: 'server',
  l2Switch: 'l2_switch',
  router: 'router',
  l3Switch: 'l3_switch',
  routerSwitch: 'router_switch',
  firewall: 'firewall',
  // プリンター（N51b）
  printer: 'printer',
} as const;

// 分類が PC か（機器の分類の判定はここだけで行う。N116）
export const isPcCategory = (category: string): boolean => category === CATEGORY.pc;

export type Category = (typeof CATEGORY)[keyof typeof CATEGORY];

// 分類の一覧（スキーマの列挙に使う）
export const CATEGORY_IDS = Object.values(CATEGORY) as [Category, ...Category[]];
