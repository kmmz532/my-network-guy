// タイル: マップの1マスを、置ける物（家具・機器）と机の有無とあわせて引く。位置の判定は、ここで引いたタイルを読んで行う。
import type { GameMap } from '../data/schema';
import { isPcCategory } from '../data/categories';
import { tileKind } from '../data/tileKind';
import type { NetNode } from '../network/types';
import { deviceCategory } from '../registry/query';
import { isDeskFurniture, type Env, type PlacedFurniture } from '../sim/project';

export type TileKind = string | undefined;

export interface TileSource {
  map: GameMap;
  furniture: readonly PlacedFurniture[];
  nodes: readonly NetNode[];
  // 自社オフィスの規則（机は家具）。false は依頼先の規則（机は地図の desk のマス）
  office: boolean;
  // PC を机のない床にも置ける（今のサンドボックス）
  anyFloor: boolean;
}

export interface Tile {
  kind: TileKind;
  furniture: readonly PlacedFurniture[];
  node: NetNode | null;
  desk: boolean;
}

export const tileAt = (src: TileSource, x: number, y: number, env: Env): Tile => {
  const kind = tileKind(src.map, x, y);
  const furniture = src.furniture.filter((f) => f.x === x && f.y === y);
  const node = src.nodes.find((n) => n.x === x && n.y === y) ?? null;
  const desk = src.office ? furniture.some((f) => isDeskFurniture(f.id, env)) : kind === 'desk';
  return { kind, furniture, node, desk };
};

// 機器が机の上にあるか
export const restsOnDesk = (src: TileSource, node: NetNode, env: Env): boolean => tileAt(src, node.x, node.y, env).desk;

// 机の絵（天板）を機器の下に描く必要があるか。机のないマスの PC に描く（サンドボックスでは描かない）
export const needsDeskSprite = (src: TileSource, node: NetNode, env: Env): boolean =>
  !tileAt(src, node.x, node.y, env).desk && isPcCategory(deviceCategory(node.device)) && !src.anyFloor;
