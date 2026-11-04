// スプライト（src/assets/sprites/**/*.png）の URL とテクスチャ。名前は拡張子を除いた相対パス（例: device/pc_basic）
import { Assets, type Texture } from 'pixi.js';

const urls: Record<string, string> = {};
for (const [path, url] of Object.entries(
  import.meta.glob('../assets/sprites/**/*.png', { eager: true, query: '?url', import: 'default' }),
)) {
  urls[path.replace('../assets/sprites/', '').replace(/\.png$/, '')] = url as string;
}

export const spriteUrl = (name: string): string | undefined => urls[name];

const textures: Record<string, Texture> = {};

// すべてのスプライトを読み込む。ドット絵が崩れないよう補間を行わない
export const loadTextures = async (): Promise<void> => {
  await Promise.all(
    Object.entries(urls).map(async ([name, url]) => {
      const texture = await Assets.load<Texture>(url);
      texture.source.scaleMode = 'nearest';
      textures[name] = texture;
    }),
  );
};

export const texture = (name: string): Texture | undefined => textures[name];
