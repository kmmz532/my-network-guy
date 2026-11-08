// マップ上の位置の判定（画面の座標からマップの座標・マス・機器・配線・家具を引く）。Scene と MapInput が使う。
import type { Application, Container, FederatedPointerEvent } from 'pixi.js';
import type { GameMap } from '../data/schema';
import { editNetOf, focusedProject, viewingOffice, useGameStore } from '../stores/useGameStore';
import type { PlacedFurniture } from '../sim/project';
import type { NetLink, NetNode } from '../network/types';
import { linkAt } from './linkHit';
import { screenToMap } from './camera';
import type { MapCamera } from './MapCamera';
import type { Point } from './animation';

// 機器を押したと見なす範囲（画面で一辺 44 px 以上）
const NODE_HIT_SCREEN_PX = 44;

export interface MapHitHost {
  app: Application;
  content: Container;
  cam: MapCamera;
  map(): GameMap | null;
  tileSize(): number;
}

export class MapHit {
  constructor(private host: MapHitHost) {}

  // 拡大率
  get scale(): number {
    return this.host.content.scale.x;
  }

  // マップの座標に変換する（拡大と配置の補正を除いた、タイルの座標系）
  toMap(e: FederatedPointerEvent): { x: number; y: number } {
    return this.toMapAt(e.global);
  }

  toMapAt(global: Point): { x: number; y: number } {
    return this.host.cam.toMapAt(global);
  }

  // 機器を編集できる対象の機器（自社オフィス、または設計中の案件）。編集できなければ null
  editNodes(): NetNode[] | null {
    return editNetOf(useGameStore.getState())?.nodes ?? null;
  }

  // 機器を押したと見なす範囲（画面で一辺 44 px 以上）の中で、中心が最も近い機器。拡大率で割って、マップの座標で判定する
  nodeNear(p: { x: number; y: number }, nodes: readonly NetNode[]): NetNode | undefined {
    const ts = this.host.tileSize();
    const half = Math.max(ts / 2, NODE_HIT_SCREEN_PX / 2 / this.scale);
    let found: NetNode | undefined;
    let best = Infinity;
    for (const n of nodes) {
      const dx = Math.abs(p.x - (n.x * ts + ts / 2));
      const dy = Math.abs(p.y - (n.y * ts + ts / 2));
      if (dx > half || dy > half) continue;
      const d = dx * dx + dy * dy;
      if (d < best) {
        best = d;
        found = n;
      }
    }
    return found;
  }

  tileOf(p: { x: number; y: number }): { tx: number; ty: number } | null {
    const map = this.host.map();
    if (!map) return null;
    const tx = Math.floor(p.x / map.tileSize);
    const ty = Math.floor(p.y / map.tileSize);
    if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return null;
    return { tx, ty };
  }

  // 画面の座標（クライアントの座標）のマス。マップの外なら null
  tileAtClient(clientX: number, clientY: number): { tx: number; ty: number } | null {
    const cam = this.host.cam.current;
    if (!cam) return null;
    const rect = this.host.app.canvas.getBoundingClientRect();
    return this.tileOf(screenToMap({ x: clientX - rect.left, y: clientY - rect.top }, cam));
  }

  // 右クリックで撤去できる配線: 自社オフィス、または案件の設計中の配線。なければ null
  removableLinks(): readonly NetLink[] | null {
    const s = useGameStore.getState();
    if (viewingOffice(s)) return s.office.links;
    const project = focusedProject(s);
    return project?.phase === 'design' ? project.links : null;
  }

  // マウスの位置にある撤去できる配線（マップの座標で判定し、拡大率を考慮する）
  linkUnder(p: { x: number; y: number }): NetLink | undefined {
    const links = this.removableLinks();
    if (!links) return undefined;
    return linkAt(links, p.x, p.y, this.host.tileSize(), this.scale);
  }

  // 編集できるケーブル（自社オフィス、または設計中の案件）
  editLinks(): readonly NetLink[] | null {
    return editNetOf(useGameStore.getState())?.links ?? null;
  }

  // 自社オフィスで動かせる家具（押した位置のマス）。案件の受注中や納品の結果の表示では動かせない
  furnitureAt(tile: { tx: number; ty: number }): PlacedFurniture | undefined {
    const s = useGameStore.getState();
    if (this.host.map()?.id !== 'hq' || s.active.length > 0 || s.showcase) return undefined;
    return s.office.furniture.find((f) => f.x === tile.tx && f.y === tile.ty);
  }
}
