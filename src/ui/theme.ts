// 角丸の値（ART.md「8a. 角丸の決まり」）。直接 px を書かず、この定数を使う。
// chrome: 画面の外枠の部品（ツールバーと HUD のボタン、ツールチップ、ウィンドウとポップアップの外枠）
// tab: タブの上の2つの角だけ
// none: パネルの中のすべて（マップの上の部品には使わない）
export const RADIUS = { chrome: 4, tab: 2, none: 0 } as const;

// ウィンドウの帯（タイトル）とタブの高さ（px）。中身の大きさ（絵や文字）に関係なく、この高さに固定する。
// 中身は UI の大きさの倍率（--ui-scale）で拡大するため、枠にも同じ倍率を掛ける（uiScaled）。
export const WINDOW_BAR_HEIGHT = 28;
export const WINDOW_TAB_HEIGHT = 28;
// タブの帯の上の余白（px）。帯の高さは、この余白とタブの高さを足したもの
export const WINDOW_TAB_GAP = 4;

// px に UI の大きさの倍率を掛けた値（CSS の calc）。zoom で拡大する中身と高さを揃えるために使う
export const uiScaled = (px: number): string => `calc(${px}px * var(--ui-scale, 1))`;
