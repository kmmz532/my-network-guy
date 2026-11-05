// ドット絵のアイコン。整数倍で拡大し、補間を行わない
import { useEffect, useState } from 'react';
import { spriteUrl } from '../game/sprites';
import { trimmedSprite, type TrimmedSprite } from '../ui/spriteBounds';

interface Props {
  // スプライトの名前（例: icon/money、device/pc_basic）
  name: string;
  scale?: number;
}

// スプライトの元の大きさ（gen-sprites.py と合わせる）
const sizeOf = (name: string): [number, number] => {
  if (name.startsWith('device/')) return [24, 40];
  if (name.startsWith('staff/')) return [16, 24];
  return [16, 16];
};

// 透明な余白を切り落としたアイコン。高さは height（px）に収まる最大の整数倍にする（帯やタブの高さを、元の画像の余白に左右させないため）
export function TrimmedIcon({ name, height = 16 }: { name: string; height?: number }) {
  const url = spriteUrl(name);
  const [sprite, setSprite] = useState<TrimmedSprite | null | undefined>(undefined);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    trimmedSprite(url, height).then((s) => {
      if (alive) setSprite(s);
    });
    return () => {
      alive = false;
    };
  }, [url, height]);
  if (!url) return null;
  // 読み込み中は同じ高さの空き（ずれを防ぐ）
  if (sprite === undefined) return <span style={{ display: 'inline-block', flexShrink: 0, width: height, height }} />;
  // 切り抜けなかったときは、元の画像を高さだけ縮めて出す
  if (sprite === null) return <img src={url} alt="" height={height} style={{ imageRendering: 'pixelated', flexShrink: 0, height, width: 'auto' }} />;
  return <img src={sprite.src} alt="" width={sprite.w} height={sprite.h} style={{ imageRendering: 'pixelated', flexShrink: 0, display: 'block' }} />;
}

export function Icon({ name, scale = 2 }: Props) {
  const url = spriteUrl(name);
  if (!url) return null;
  const style = { imageRendering: 'pixelated', verticalAlign: 'middle', display: 'inline-block' } as const;
  // 家具は高さがまちまちなので、幅だけ整数倍にして高さは画像の比率に任せる（拡大は整数倍のまま）
  if (name.startsWith('furniture/')) {
    return <img src={url} alt="" width={32 * scale} style={{ ...style, height: 'auto' }} />;
  }
  const [w, h] = sizeOf(name);
  return <img src={url} alt="" width={w * scale} height={h * scale} style={style} />;
}
