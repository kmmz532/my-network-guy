// タイルマップの描画。3/4ビューの断面図として、床・奥の壁・家具をスプライトで描く（ART.md「視点」）
import { Container, Graphics, Sprite } from 'pixi.js';
import type { GameMap } from '../data/schema';
import { texture } from './sprites';

// 奥の壁に掛ける物。壁として扱い、真下が床のときに壁の正面へ描く
const wallDecor = new Set(['window', 'clock', 'poster', 'whiteboard']);
const isWall = (kind: string | undefined): boolean => kind === 'wall' || (kind !== undefined && wallDecor.has(kind));

// スプライトがないときの塗り色（ART.md のパレット）
const fallbackColor: Record<string, number> = { floor: 0xe0b77c, wall: 0xcfc3aa };

// 床の板の継ぎ目が揃わないよう、座標から種類を決める
const floorVariant = (x: number, y: number): number => (x * 7 + y * 13 + ((x * y) % 5)) % 3;

export const drawTileMap = (map: GameMap): Container => {
  const container = new Container();
  const g = new Graphics();
  container.addChild(g);
  const ts = map.tileSize;
  const kindAt = (x: number, y: number): string | undefined => map.legend[map.tiles[y]?.[x]];
  const put = (name: string, x: number, y: number): boolean => {
    const tex = texture(name);
    if (!tex) return false;
    const sprite = new Sprite(tex);
    // 下端をマスの下端に揃え、1マスより高い分は上へはみ出させる
    sprite.position.set(x * ts + Math.round((ts - tex.width) / 2), (y + 1) * ts - tex.height);
    container.addChild(sprite);
    return true;
  };

  // 床と壁を先に敷き、家具は上の行から順に重ねる（手前の家具が奥の家具を隠す）
  const furniture: [string, number, number][] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const kind = kindAt(x, y);
      if (isWall(kind)) {
        // 真下が床なら奥の壁の正面、それ以外は壁の上面
        const face = !isWall(kindAt(x, y + 1)) && y + 1 < map.height;
        const name = face ? (kind === 'wall' ? 'tile/wall_face' : `tile/${kind}`) : 'tile/wall_top';
        if (!put(name, x, y)) g.rect(x * ts, y * ts, ts, ts).fill(fallbackColor.wall);
        continue;
      }
      if (!put(`tile/floor_${floorVariant(x, y)}`, x, y)) g.rect(x * ts, y * ts, ts, ts).fill(fallbackColor.floor);
      if (kind && kind !== 'floor') furniture.push([kind, x, y]);
    }
  }
  for (const [kind, x, y] of furniture) put(`furniture/${kind}`, x, y);
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
