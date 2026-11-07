// タイルマップの描画。3/4ビューの断面図として、床・奥の壁・家具をスプライトで描く（ART.md「視点」）
import { Container, Graphics, Sprite } from 'pixi.js';
import type { GameMap } from '../data/schema';
import { spriteOf, texture } from './sprites';
import { tileKind, VOID_KIND } from '../data/tileKind';

// 柱と、柱と同じ箱の形で描く障害物（カウンター・本棚・倉庫の棚）。床ではない・壁でもない。隣の壁の上面や影を出さない。
// 柱は色で塗り、ほかは天面（tile/<種類>_top）と下の段の正面（tile/<種類>_face）の絵を敷く
const BLOCK_KINDS: ReadonlySet<string> = new Set(['pillar', 'counter', 'shelf', 'rack']);
const isPillar = (kind: string | undefined): boolean => kind !== undefined && BLOCK_KINDS.has(kind);

// 奥の壁に掛ける物。壁として扱い、真下が床のときに壁の正面へ描く
const wallDecor = new Set(['window', 'clock', 'poster', 'whiteboard']);
const isWall = (kind: string | undefined): boolean => kind === 'wall' || (kind !== undefined && wallDecor.has(kind));

// 左右・手前の壁は上面（厚み）だけが見える（ART.md「視点」）
export const CAP = 5;
const CAP_COLOR = 0xcfc3aa;
const FRONT_CAP_COLOR = 0xb0a088; // 手前の壁は少し暗くする
const CAP_EDGE_COLOR = 0x3b2a33; // 上面の内側の縁（輪郭線の色）
// 柱の正面（下の段の下の部分）の高さと、巾木の高さ。正面の色は奥の壁（tile/wall_face.png の W1）と同じ
const PILLAR_FACE = 14;
const PILLAR_BASE = 4;
const PILLAR_FACE_COLOR = 0xefe7d6;
const WALL_TOP_BAND = 3; // 奥の壁の上面の帯の高さ（tile/wall_face.png の上端の帯に合わせる）
// 光源は左上。左の壁と奥の壁の下の床に影を落とす
const SHADOW = 6;
const SHADOW_COLOR = 0x3b2a33;
const SHADOW_ALPHA = 0.18;

// 床の板の継ぎ目が揃わないよう、座標から種類を決める
const floorVariant = (x: number, y: number): number => (x * 7 + y * 13 + ((x * y) % 5)) % 3;
// 床の絵の名前（map.floor。wood は tile/floor_0〜2）
const floorSprite = (floor: GameMap['floor'], x: number, y: number): string =>
  floor === 'wood' ? `tile/floor_${floorVariant(x, y)}` : `tile/floor_${floor}_${floorVariant(x, y)}`;

export const drawTileMap = (map: GameMap): Container => {
  const container = new Container();
  // 地面（屋外の芝）は壁の上面より下に描く。壁の上面と線は g（地面の上）に描く
  const groundLayer = new Container();
  container.addChild(groundLayer);
  const g = new Graphics();
  container.addChild(g);
  const ts = map.tileSize;
  const kindAt = (x: number, y: number): string | undefined => tileKind(map, x, y);
  const put = (name: string, x: number, y: number): boolean => {
    const tex = texture(spriteOf(name));
    if (!tex) return false;
    const sprite = new Sprite(tex);
    // 下端をマスの下端に揃え、1マスより高い分は上へはみ出させる
    sprite.position.set(x * ts + Math.round((ts - tex.width) / 2), (y + 1) * ts - tex.height);
    container.addChild(sprite);
    return true;
  };

  // 屋外（芝・道路）は部屋の床ではないので、壁の上面や奥の壁の正面を作らない
  const isOutdoor = (k: string | undefined): boolean => k === 'ground' || k === 'road';
  // 何もない場所（void）は床ではなく、何も描かない
  const isVoid = (k: string | undefined): boolean => k === VOID_KIND;
  const floorAt = (x: number, y: number): boolean => {
    const k = kindAt(x, y);
    return k !== undefined && !isWall(k) && !isOutdoor(k) && !isVoid(k) && !isPillar(k);
  };
  // 奥の壁の正面（真下が床の壁）と、手前の壁（真上が床の壁）。
  // 仕切りの壁（左右とも床）は正面にせず、上面で描く。上端の壁は、両隣が正面なら、その間をつないで隙間を作らない
  const frontFaceAt = (x: number, y: number): boolean => isWall(kindAt(x, y)) && floorAt(x, y + 1) && !(floorAt(x - 1, y) && floorAt(x + 1, y));
  const faceAt = (x: number, y: number): boolean => frontFaceAt(x, y) || (y === 0 && isWall(kindAt(x, y)) && frontFaceAt(x - 1, y) && frontFaceAt(x + 1, y));
  const frontAt = (x: number, y: number): boolean => isWall(kindAt(x, y)) && floorAt(x, y - 1);

  // 床と壁を先に敷き、家具は上の行から順に重ねる（手前の家具が奥の家具を隠す）
  const furniture: [string, number, number][] = [];
  // 柱のマス（床と家具の後に、まとめて描く）
  const pillars: [number, number][] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const kind = kindAt(x, y);
      if (isWall(kind)) {
        // 屋外に接する外壁の下には芝を敷く。部屋の側には、ほかの壁と同じ細い上面を描く
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isOutdoor(kindAt(x + dx, y + dy)))) {
          const tex = texture(spriteOf(`tile/ground_${(x * 7 + y * 3) % 2}`));
          if (tex) {
            const sprite = new Sprite(tex);
            sprite.position.set(x * ts, y * ts);
            groundLayer.addChild(sprite);
          }
        }
        // 真下が床なら奥の壁の正面として描く
        const face = faceAt(x, y);
        if (face) {
          put(kind === 'wall' ? 'tile/wall_face' : `tile/${kind}`, x, y);
          continue;
        }
        // 仕切りの壁は、両側が床なので中を塗る（上面の帯だけだと、中が背景に抜けて見える）
        if (floorAt(x - 1, y) && floorAt(x + 1, y)) g.rect(x * ts, y * ts, ts, ts).fill(CAP_COLOR);
        // 左右と手前の壁は、床に接する辺に上面を描く。外側は背景のまま
        const r = x * ts + ts; // 右端
        // 上面の内側の縁に1 pxの線を引く。奥の壁の横では、奥の壁の上面の帯より下だけに引き、上面どうしをL字につなげる
        const edgeTop = (nx: number): number => (faceAt(nx, y) ? WALL_TOP_BAND : 0);
        // 隣が床・奥の壁の正面・遮るもの（カウンターなど）なら、壁の上面を描く（遮るものの横で壁が途切れないように）
        if (floorAt(x + 1, y) || faceAt(x + 1, y) || isPillar(kindAt(x + 1, y))) {
          g.rect(r - CAP, y * ts, CAP, ts).fill(CAP_COLOR);
          g.rect(r - 1, y * ts + edgeTop(x + 1), 1, ts - edgeTop(x + 1)).fill(CAP_EDGE_COLOR);
        }
        if (floorAt(x - 1, y) || faceAt(x - 1, y) || isPillar(kindAt(x - 1, y))) {
          g.rect(x * ts, y * ts, CAP, ts).fill(CAP_COLOR);
          g.rect(x * ts, y * ts + edgeTop(x - 1), 1, ts - edgeTop(x - 1)).fill(CAP_EDGE_COLOR);
        }
        if (floorAt(x, y - 1)) {
          g.rect(x * ts, y * ts, ts, CAP).fill(FRONT_CAP_COLOR);
          g.rect(x * ts, y * ts, ts, 1).fill(CAP_EDGE_COLOR);
        }
        // 手前の角は、左右の上面と手前の上面をつなぐ
        if (!floorAt(x, y - 1) && frontAt(x + 1, y)) g.rect(r - CAP, y * ts, CAP, CAP).fill(FRONT_CAP_COLOR);
        if (!floorAt(x, y - 1) && frontAt(x - 1, y)) g.rect(x * ts, y * ts, CAP, CAP).fill(FRONT_CAP_COLOR);
        continue;
      }
      if (kind === 'ground') {
        put(`tile/ground_${(x * 7 + y * 3) % 2}`, x, y);
        continue;
      }
      if (kind === 'road') {
        put('tile/road', x, y);
        continue;
      }
      if (isVoid(kind)) continue;
      // ドアは通れる床。ドアのスプライトを床の上に描く（家具の対象にはしない）
      if (kind === 'door') {
        put('tile/door', x, y);
        continue;
      }
      if (isPillar(kind)) {
        pillars.push([x, y]);
        continue;
      }
      put(floorSprite(map.floorTiles?.[`${x},${y}`] ?? map.floor, x, y), x, y);
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
  // 柱。並んだ柱のマスを1本の太い柱として描く（ART.md「視点」の 3/4 ビュー）。
  // 天面は壁の上面と同じ色。下の段（真下が柱でないマス）だけ、下の部分を正面（壁の色と巾木）にする。
  // 輪郭は、隣が柱でない辺にだけ引く。影は光源（左上）の反対の、右と下の床に落とす
  // 天面・正面の絵は、輪郭線（pg）より下の層に敷く
  const pictures = new Container();
  container.addChild(pictures);
  const pg = new Graphics();
  container.addChild(pg);
  // 同じ種類の障害物どうしだけを1つの箱としてつなぐ
  const pillarAt = (x: number, y: number, kind: string | undefined): boolean => kindAt(x, y) === kind;
  const sprite = (name: string, x0: number, y0: number): void => {
    const tex = texture(spriteOf(name));
    if (!tex) return;
    const sp = new Sprite(tex);
    sp.position.set(x0, y0);
    pictures.addChild(sp);
  };
  for (const [px, py] of pillars) {
    const kind = kindAt(px, py);
    const at = (x: number, y: number): boolean => pillarAt(x, y, kind);
    const x = px;
    const y = py;
    const x0 = x * ts;
    const y0 = y * ts;
    const bottom = !at(x, y + 1);
    if (kind === 'pillar') pg.rect(x0, y0, ts, ts).fill(CAP_COLOR);
    else sprite(`tile/${kind}_top`, x0, y0);
    if (bottom) {
      const fy = y0 + ts - PILLAR_FACE;
      if (kind === 'pillar') {
        pg.rect(x0, fy, ts, PILLAR_FACE).fill(PILLAR_FACE_COLOR);
        pg.rect(x0, y0 + ts - PILLAR_BASE, ts, PILLAR_BASE).fill(FRONT_CAP_COLOR);
      } else sprite(`tile/${kind}_face`, x0, fy);
      pg.rect(x0, fy, ts, 1).fill(CAP_EDGE_COLOR);
      if (floorAt(x, y + 1)) shade.rect(x0, y0 + ts, ts, SHADOW).fill({ color: SHADOW_COLOR, alpha: SHADOW_ALPHA });
    }
    if (!at(x - 1, y)) pg.rect(x0, y0, 1, ts).fill(CAP_EDGE_COLOR);
    if (!at(x + 1, y)) {
      pg.rect(x0 + ts - 1, y0, 1, ts).fill(CAP_EDGE_COLOR);
      if (floorAt(x + 1, y)) shade.rect(x0 + ts, y0, SHADOW, ts).fill({ color: SHADOW_COLOR, alpha: SHADOW_ALPHA });
    }
    if (!at(x, y - 1)) pg.rect(x0, y0, ts, 1).fill(CAP_EDGE_COLOR);
    if (bottom) pg.rect(x0, y0 + ts - 1, ts, 1).fill(CAP_EDGE_COLOR);
  }
  for (const [kind, x, y] of furniture) put(`furniture/${kind}`, x, y);
  return container;
};
