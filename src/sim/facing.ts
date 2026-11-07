// 家具（机・椅子）と PC の向き（N95）。向きの名前は「座った社員が向く方向」。純粋な関数。
// 絵の名前: up は今の名前のまま、ほかは _front（手前）・_left・_right を付ける。絵がない向きは例外にする（R5）。

export const FACINGS = ['up', 'down', 'left', 'right'] as const;
export type Facing = (typeof FACINGS)[number];

const SUFFIX: Record<Facing, string> = { up: '', down: '_front', left: '_left', right: '_right' };

// 品目の絵の名前（base）と向きから、絵の名前を求める（例: desk + left → desk_left）
export const spriteNameOf = (base: string, facing: Facing): string => {
  if (!FACINGS.includes(facing)) throw new Error(`向きが不正: ${String(facing)}`);
  return `${base}${SUFFIX[facing]}`;
};

// 90度回す（時計回り）。上 → 右 → 手前 → 左 → 上
export const rotateFacing = (facing: Facing): Facing => {
  const order: Facing[] = ['up', 'right', 'down', 'left'];
  return order[(order.indexOf(facing) + 1) % order.length];
};
