// タイルマップの描画。3/4ビューの断面図として、床・奥の壁・家具をスプライトで描く（ART.md「視点」）
import { Container, Graphics, Sprite } from 'pixi.js';
import type { GameMap } from '../data/schema';
import { texture } from './sprites';

// 奥の壁に掛ける物。壁として扱い、真下が床のときに壁の正面へ描く
const wallDecor = new Set(['window', 'clock', 'poster', 'whiteboard']);
const isWall = (kind: string | undefined): boolean => kind === 'wall' || (kind !== undefined && wallDecor.has(kind));

// スプライトがないときの塗り色（ART.md のパレット）
const fallbackColor: Record<string, number> = { floor: 0xe0b77c, wall: 0xcfc3aa };

// 左右・手前の壁は上面（厚み）だけが見える（ART.md「視点」）
const CAP = 10;
const CAP_COLOR = 0xcfc3aa;
const FRONT_CAP_COLOR = 0xb0a088; // 手前の壁は少し暗くする
const LINE_COLOR = 0x3b2a33; // 上面の床側の縁（壁の段差）
// 光源は左上。左の壁と奥の壁の下の床に影を落とす
const SHADOW = 4;
const SHADOW_COLOR = 0x3b2a33;
const SHADOW_ALPHA = 0.18;

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

  const floorAt = (x: number, y: number): boolean => {
    const k = kindAt(x, y);
    return k !== undefined && !isWall(k);
  };
  // 奥の壁の正面（真下が床の壁）と、手前の壁（真上が床の壁）
  const faceAt = (x: number, y: number): boolean => isWall(kindAt(x, y)) && floorAt(x, y + 1);
  const frontAt = (x: number, y: number): boolean => isWall(kindAt(x, y)) && floorAt(x, y - 1);

  // 床と壁を先に敷き、家具は上の行から順に重ねる（手前の家具が奥の家具を隠す）
  const furniture: [string, number, number][] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const kind = kindAt(x, y);
      if (isWall(kind)) {
        // 真下が床なら奥の壁の正面として描く
        const face = faceAt(x, y);
        if (face) {
          if (!put(kind === 'wall' ? 'tile/wall_face' : `tile/${kind}`, x, y)) g.rect(x * ts, y * ts, ts, ts).fill(fallbackColor.wall);
          continue;
        }
        // 左右と手前の壁は、床に接する辺に上面を描く。外側は背景のまま
        const r = x * ts + ts; // 右端
        if (floorAt(x + 1, y) || faceAt(x + 1, y)) {
          g.rect(r - CAP, y * ts, CAP, ts).fill(CAP_COLOR);
          if (floorAt(x + 1, y)) g.rect(r - 1, y * ts, 1, ts).fill(LINE_COLOR);
        }
        if (floorAt(x - 1, y) || faceAt(x - 1, y)) {
          g.rect(x * ts, y * ts, CAP, ts).fill(CAP_COLOR);
          if (floorAt(x - 1, y)) g.rect(x * ts, y * ts, 1, ts).fill(LINE_COLOR);
        }
        if (floorAt(x, y - 1)) {
          g.rect(x * ts, y * ts, ts, CAP).fill(FRONT_CAP_COLOR);
          g.rect(x * ts, y * ts, ts, 1).fill(LINE_COLOR);
        }
        // 手前の角は、左右の上面と手前の上面をつなぐ
        if (!floorAt(x, y - 1) && frontAt(x + 1, y)) g.rect(r - CAP, y * ts, CAP, CAP).fill(FRONT_CAP_COLOR);
        if (!floorAt(x, y - 1) && frontAt(x - 1, y)) g.rect(x * ts, y * ts, CAP, CAP).fill(FRONT_CAP_COLOR);
        continue;
      }
      if (!put(`tile/floor_${floorVariant(x, y)}`, x, y)) g.rect(x * ts, y * ts, ts, ts).fill(fallbackColor.floor);
      if (kind && kind !== 'floor') furniture.push([kind, x, y]);
    }
  }
  // 床に落ちる影（床の上、家具の下）
  const shade = new Graphics();
  container.addChild(shade);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!floorAt(x, y)) continue;
      const left = isWall(kindAt(x - 1, y));
      if (left) shade.rect(x * ts, y * ts, SHADOW, ts).fill({ color: SHADOW_COLOR, alpha: SHADOW_ALPHA });
      // 角では左の影と重ならないようにする
      if (isWall(kindAt(x, y - 1))) {
        const sx = left ? SHADOW : 0;
        shade.rect(x * ts + sx, y * ts, ts - sx, SHADOW).fill({ color: SHADOW_COLOR, alpha: SHADOW_ALPHA });
      }
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
