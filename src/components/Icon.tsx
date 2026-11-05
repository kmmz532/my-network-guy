// ドット絵のアイコン。整数倍で拡大し、補間を行わない
import { spriteUrl } from '../game/sprites';

interface Props {
  // スプライトの名前（例: icon/money、device/pc_basic）
  name: string;
  scale?: number;
  title?: string;
}

// スプライトの元の大きさ（gen-sprites.py と合わせる）
const sizeOf = (name: string): [number, number] => {
  if (name.startsWith('device/')) return [24, 40];
  if (name.startsWith('staff/')) return [16, 24];
  return [16, 16];
};

export function Icon({ name, scale = 2, title }: Props) {
  const url = spriteUrl(name);
  if (!url) return null;
  const style = { imageRendering: 'pixelated', verticalAlign: 'middle', display: 'inline-block' } as const;
  // 家具は高さがまちまちなので、幅だけ整数倍にして高さは画像の比率に任せる（拡大は整数倍のまま）
  if (name.startsWith('furniture/')) {
    return <img src={url} alt="" title={title} width={32 * scale} style={{ ...style, height: 'auto' }} />;
  }
  const [w, h] = sizeOf(name);
  return <img src={url} alt="" title={title} width={w * scale} height={h * scale} style={style} />;
}
