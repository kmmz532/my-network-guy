// タイルマップの描画。1マス tileSize px の矩形を、マップの legend に従って塗る。
import { Container, Graphics } from 'pixi.js';
import type { GameMap } from '../data/schema';

// 色は ART.md のパレット（床・壁の明度を高くし、背景に徹する）
const colorOf: Record<string, number> = {
  floor: 0xe0b77c,
  wall: 0xcfc3aa,
  desk: 0xa06a45,
};
const fallbackColor = 0xff00ff;

export const drawTileMap = (map: GameMap): Container => {
  const container = new Container();
  const g = new Graphics();
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const kind = map.legend[map.tiles[y][x]];
      g.rect(x * map.tileSize, y * map.tileSize, map.tileSize, map.tileSize).fill(colorOf[kind] ?? fallbackColor);
    }
  }
  container.addChild(g);
  return container;
};

// 整数倍だけで拡大し、表示領域の中央に置く（補間を行わないためドット絵が崩れない）
export const layoutIntegerScale = (content: Container, map: GameMap, viewW: number, viewH: number): void => {
  const mapW = map.width * map.tileSize;
  const mapH = map.height * map.tileSize;
  const scale = Math.max(1, Math.floor(Math.min(viewW / mapW, viewH / mapH)));
  content.scale.set(scale);
  content.position.set(Math.round((viewW - mapW * scale) / 2), Math.round((viewH - mapH * scale) / 2));
};
