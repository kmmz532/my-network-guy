// スプライトの不透明な部分の範囲を求め、透明な余白を切り落とした画像を作る。ウィンドウの帯やタブの高さを、余白の大きさに左右されないようにするための部品。
// 画素の走査（opaqueBoundsOf）は純粋関数にして、canvas の読み込み（trimmedSprite）と分けている。結果は URL と高さの組ごとにキャッシュする。

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 切り抜いた画像。w と h は表示するときの大きさ（px）
export interface TrimmedSprite {
  src: string;
  w: number;
  h: number;
}

// 不透明とみなす α の下限（0 から 255）。1 以上なら、わずかでも色のある画素を含める
const OPAQUE_ALPHA = 1;

// RGBA の画素列（幅 w、高さ h）から、不透明な画素をすべて含む最小の矩形を返す。不透明な画素がなければ null
export function opaqueBoundsOf(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Bounds | null {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] < OPAQUE_ALPHA) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`スプライトを読み込めません: ${url}`));
    img.src = url;
  });

// 画像の不透明な部分を切り出し、高さが maxHeight に収まる最大の整数倍で拡大する（ドット絵のため、補間しない）
async function render(url: string, maxHeight: number): Promise<TrimmedSprite | null> {
  const img = await loadImage(url);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const full = document.createElement('canvas');
  full.width = W;
  full.height = H;
  const fctx = full.getContext('2d', { willReadFrequently: true });
  if (!fctx) return null;
  fctx.drawImage(img, 0, 0);
  const bounds = opaqueBoundsOf(fctx.getImageData(0, 0, W, H).data, W, H);
  if (!bounds) return null;

  const scale = Math.max(1, Math.floor(maxHeight / bounds.h));
  const out = document.createElement('canvas');
  out.width = bounds.w * scale;
  out.height = bounds.h * scale;
  const octx = out.getContext('2d');
  if (!octx) return null;
  octx.imageSmoothingEnabled = false;
  octx.drawImage(full, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, out.width, out.height);
  return { src: out.toDataURL('image/png'), w: out.width, h: out.height };
}

const cache = new Map<string, Promise<TrimmedSprite | null>>();

// URL の画像の不透明な部分を、高さが maxHeight に収まるように切り抜いて返す。読めなければ null。結果はキャッシュする
export function trimmedSprite(url: string, maxHeight: number): Promise<TrimmedSprite | null> {
  const key = `${url}|${maxHeight}`;
  let result = cache.get(key);
  if (!result) {
    result = render(url, maxHeight).catch(() => null);
    cache.set(key, result);
  }
  return result;
}
