// 角丸の値（ART.md「8a. 角丸の決まり」）。直接 px を書かず、この定数を使う。
// chrome: 画面の外枠の部品（ツールバーと HUD のボタン、ツールチップ、ウィンドウとポップアップの外枠）
// tab: タブの上の2つの角だけ
// none: パネルの中のすべて（マップの上の部品には使わない）
export const RADIUS = { chrome: 4, tab: 2, none: 0 } as const;
