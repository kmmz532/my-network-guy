// ドット絵のアイコン。整数倍で拡大し、補間を行わない
import { useEffect, useReducer, useState } from 'react';
import { spriteOf, spriteUrl } from '../game/sprites';
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

// 整数でない倍率（1.5倍など）の表示用に、整数倍（最近傍）で拡大してから目的の大きさへ滑らかに縮めた画像を作る。
// 画素の大きさがそろい、縁だけがわずかにぼやける。結果は URL（data:）で、同じ組み合わせは一度だけ作る
const scaledCache = new Map<string, string>();

const scaleSprite = (url: string, w: number, h: number, scale: number): Promise<string> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const k = Math.ceil(scale);
        const mid = document.createElement('canvas');
        mid.width = w * k;
        mid.height = h * k;
        const m = mid.getContext('2d');
        if (!m) throw new Error('canvas');
        m.imageSmoothingEnabled = false;
        m.drawImage(img, 0, 0, w * k, h * k);

        const tw = Math.round(w * scale);
        const th = Math.round(h * scale);
        const out = document.createElement('canvas');
        out.width = tw;
        out.height = th;
        const o = out.getContext('2d');
        if (!o) throw new Error('canvas');
        o.imageSmoothingEnabled = true;
        o.imageSmoothingQuality = 'high';
        o.drawImage(mid, 0, 0, tw, th);
        resolve(out.toDataURL('image/png'));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = reject;
    img.src = url;
  });

// 整数倍なら元の画像をそのまま使う。整数でなければ、作った画像が用意できるまで元の画像を出す
const useScaledSrc = (url: string, w: number, h: number, scale: number): string => {
  const integer = w === 0 || Number.isInteger(scale);
  const key = `${url}|${w}|${h}|${scale}`;
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (integer || scaledCache.has(key)) return;
    let alive = true;
    scaleSprite(url, w, h, scale)
      .then((src) => {
        scaledCache.set(key, src);
        if (alive) rerender();
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key, integer, url, w, h, scale]);
  return integer ? url : (scaledCache.get(key) ?? url);
};

// 透明な余白を切り落としたアイコン。高さは height（px）に収まる最大の整数倍にする（帯やタブの高さを、元の画像の余白に左右させないため）
// width は枠の幅（省くと高さの 1.5 倍）、maxScale は拡大の上限
export function TrimmedIcon({ name, height = 16, width, maxScale }: { name: string; height?: number; width?: number; maxScale?: number }) {
  const url = spriteUrl(spriteOf(name));
  const [sprite, setSprite] = useState<TrimmedSprite | null | undefined>(undefined);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    trimmedSprite(url, { maxHeight: height, maxWidth: width, maxScale }).then((s) => {
      if (alive) setSprite(s);
    });
    return () => {
      alive = false;
    };
  }, [url, height, width, maxScale]);
  if (!url) return null;
  // 外側の span は高さと行の高さを固定し、絵がはみ出しても枠（height）を超えないようにする
  // 絵は枠の中央に置く（幅を指定したときは枠の幅も固定し、横にも中央にそろえる）。品目の絵（ItemIcon）とショップの絵をそろえるため
  const frame = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, height, ...(width !== undefined ? { width } : {}), lineHeight: `${height}px`, overflow: 'hidden', verticalAlign: 'top' } as const;
  // 読み込み中は同じ高さの空き（ずれを防ぐ）
  if (sprite === undefined) return <span style={{ ...frame, width: height }} />;
  // 切り抜けなかったときは、元の画像を高さだけ縮めて出す
  if (sprite === null) {
    return (
      <span style={frame}>
        <img draggable={false} src={url} alt="" height={height} style={{ imageRendering: 'pixelated', display: 'block', height, width: 'auto' }} />
      </span>
    );
  }
  return (
    <span style={frame}>
      <img draggable={false} src={sprite.src} alt="" width={sprite.w} height={sprite.h} style={{ imageRendering: 'pixelated', display: 'block', maxHeight: height, maxWidth: width ?? height * 1.5 }} />
    </span>
  );
}

export function Icon({ name, scale = 2, style: customStyle }: Props & { style?: React.CSSProperties }) {
  const url = spriteUrl(spriteOf(name));
  // 家具は高さがまちまちなので、幅だけ整数倍にして高さは画像の比率に任せる（拡大は整数倍のまま）
  const furniture = name.startsWith('furniture/');
  const [w, h] = furniture ? [0, 0] : sizeOf(name);
  const src = useScaledSrc(url ?? '', w, h, scale);
  if (!url) return null;
  const style = { imageRendering: 'pixelated', verticalAlign: 'middle', display: 'inline-block' } as const;
  if (furniture) {
    return <img draggable={false} src={url} alt="" width={32 * scale} style={{ ...style, height: 'auto' }} />;
  }
  return <img draggable={false} src={src} alt="" width={w * scale} height={h * scale} style={{ ...style, ...customStyle }} />;
}
