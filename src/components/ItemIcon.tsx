// 品目（機器・家具）の絵の共通部品。透明な余白を切り落として、固定の枠の中央に収める。
// ショップ・インベントリ・受け取った品目の札で共有する（絵の周りの余白をそろえ、大きさを揃えるため）。
import { TrimmedIcon } from './Icon';

export interface ItemBox {
  width: number;
  height: number;
}

export function ItemIcon({ name, box, maxScale = 2 }: { name: string; box: ItemBox; maxScale?: number }) {
  return (
    <div style={{ width: box.width, height: box.height, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <TrimmedIcon name={name} height={box.height} width={box.width} maxScale={maxScale} />
    </div>
  );
}
