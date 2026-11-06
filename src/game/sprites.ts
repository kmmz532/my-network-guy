// スプライト（src/assets/sprites/**/*.png）の URL とテクスチャ。名前は拡張子を除いた相対パス（例: device/pc_basic）。
// 名前の型（SpriteId）はビルド時に生成する。文字列の組み立ては spriteOf で検査する。
import { Assets, type Texture } from 'pixi.js';
import type { SpriteId } from '../generated/ids';

const urls = new Map<string, string>();
for (const [path, url] of Object.entries(
  import.meta.glob('../assets/sprites/**/*.png', { eager: true, query: '?url', import: 'default' }),
)) {
  urls.set(path.replace('../assets/sprites/', '').replace(/\.png$/, ''), url as string);
}

export const isSpriteName = (name: string): name is SpriteId => urls.has(name);

// 組み立てた名前を SpriteId にする。ないスプライトは、開発中は例外にして誤りを見逃さない。本番では警告を出し、描けないだけにする
export const spriteOf = (name: string): SpriteId => {
  if (!isSpriteName(name)) {
    const message = `スプライト ${name} がない`;
    if (import.meta.env.DEV) throw new Error(message);
    console.warn(message);
  }
  // 本番で見つからないときだけ、名前のまま返す（読み込みの側で描けないと判断される）
  return name as SpriteId;
};

export const spriteUrl = (name: SpriteId): string => {
  const url = urls.get(name);
  if (url === undefined) throw new Error(`スプライト ${name} の URL がない`);
  return url;
};

const textures = new Map<string, Texture>();

// すべてのスプライトを読み込む。ドット絵が崩れないよう補間を行わない
export const loadTextures = async (): Promise<void> => {
  await Promise.all(
    [...urls].map(async ([name, url]) => {
      const texture = await Assets.load<Texture>(url);
      texture.source.scaleMode = 'nearest';
      textures.set(name, texture);
    }),
  );
};

export const texture = (name: SpriteId): Texture | undefined => textures.get(name);
