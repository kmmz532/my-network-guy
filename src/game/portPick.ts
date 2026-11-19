// ケーブルの端を持ったまま機器の上に出した口の一覧で、離した位置から差す口を決める。
// DOM には触れず、一覧の各行の枠（画面の座標）と離した位置だけから決める。

// 一覧の行の枠（画面の座標。right・bottom は含まない）。port が 'auto' の行は「おまかせ」。blocked は差せない口（埋まっている・種類が合わない）
export interface PickBox {
  port: number | 'auto';
  left: number;
  top: number;
  right: number;
  bottom: number;
  blocked: boolean;
}

// 点の下の行。口の上なら port、おまかせの上なら auto、差せない口の上なら blocked、どの行の上でもなければ outside
export type PortPick = { kind: 'port'; port: number } | { kind: 'auto' } | { kind: 'blocked' } | { kind: 'outside' };

export const portPickAt = (x: number, y: number, boxes: readonly PickBox[]): PortPick => {
  const hit = boxes.find((b) => x >= b.left && x < b.right && y >= b.top && y < b.bottom);
  if (!hit) return { kind: 'outside' };
  if (hit.port === 'auto') return { kind: 'auto' };
  return hit.blocked ? { kind: 'blocked' } : { kind: 'port', port: hit.port };
};

// 離したときに差す口。口の上ならその口、一覧の外（機器の上）とおまかせの上なら null（空いた口に自動で差す）。差せない口の上は undefined（何もしない）
export const portToPlug = (pick: PortPick): number | null | undefined => {
  switch (pick.kind) {
    case 'port':
      return pick.port;
    case 'auto':
    case 'outside':
      return null;
    case 'blocked':
      return undefined;
  }
};

// 一覧の全体の枠から margin（px）以内か。機器から一覧へ動かす途中の隙間で、一覧を閉じないために使う
export const nearBoxes = (x: number, y: number, boxes: readonly PickBox[], margin: number): boolean =>
  boxes.length > 0 &&
  x >= Math.min(...boxes.map((b) => b.left)) - margin &&
  x < Math.max(...boxes.map((b) => b.right)) + margin &&
  y >= Math.min(...boxes.map((b) => b.top)) - margin &&
  y < Math.max(...boxes.map((b) => b.bottom)) + margin;
