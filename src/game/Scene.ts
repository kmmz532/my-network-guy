// キャンバスの描画と操作。マップ・機器・配線を描き、クリックで配置・選択、ドラッグで配線する。
// 描画の状態は store から読むだけで、変更は store の操作を通して行う。
import { Application, Container, Graphics, Rectangle, type FederatedPointerEvent } from 'pixi.js';
import type { GameMap } from '../data/schema';
import { useGameStore } from '../stores/useGameStore';
import { gameEnv } from '../sim/env';
import type { NetNode } from '../network/types';
import { drawTileMap, layoutIntegerScale } from './TileMap';

const OUTLINE = 0x3b2a33;
const SELECT = 0xffd866;
const CATEGORY_COLOR: Record<string, number> = {
  pc: 0xdfe3e8,
  server: 0xa3acb8,
  l2_switch: 0x4f7cc4,
  router: 0xe0644f,
};
const CABLE_COLOR: Record<string, number> = {
  utp_cat5e: 0x4a8fd6,
  fiber_sm: 0xf0a030,
};
const DEFAULT_CABLE_COLOR = 0x9fe0ff;

export class Scene {
  private content = new Container();
  private tiles: Container | null = null;
  private tilesId: string | null = null;
  private map: GameMap | null = null;
  private g = new Graphics();
  // 配線をドラッグ中の起点と現在位置（マップの座標）
  private wireFrom: string | null = null;
  private wireTo = { x: 0, y: 0 };
  private unsubscribe: () => void;

  constructor(private app: Application) {
    app.stage.addChild(this.content);
    this.content.addChild(this.g);
    app.stage.eventMode = 'static';
    app.stage.on('pointerdown', this.onDown);
    app.stage.on('pointermove', this.onMove);
    app.stage.on('pointerup', this.onUp);
    app.stage.on('pointerupoutside', this.cancelWire);
    window.addEventListener('resize', this.layout);
    this.unsubscribe = useGameStore.subscribe(() => this.refresh());
    this.refresh();
  }

  destroy(): void {
    this.unsubscribe();
    window.removeEventListener('resize', this.layout);
    this.app.stage.off('pointerdown', this.onDown);
    this.app.stage.off('pointermove', this.onMove);
    this.app.stage.off('pointerup', this.onUp);
    this.app.stage.off('pointerupoutside', this.cancelWire);
  }

  // 表示するマップを選び、タイルを描き直す。マップが読み込まれていなければ何もしない
  private refresh(): void {
    const s = useGameStore.getState();
    const mapId = s.active?.contract.map ?? 'office_small';
    const map = s.maps[mapId];
    if (!map) return;
    if (this.tilesId !== mapId) {
      if (this.tiles) this.tiles.destroy({ children: true });
      this.tiles = drawTileMap(map);
      this.content.addChildAt(this.tiles, 0);
      this.tilesId = mapId;
      this.map = map;
      this.layout();
    }
    this.drawObjects();
  }

  private layout = (): void => {
    if (!this.map) return;
    this.app.stage.hitArea = new Rectangle(0, 0, this.app.screen.width, this.app.screen.height);
    layoutIntegerScale(this.content, this.map, this.app.screen.width, this.app.screen.height);
  };

  private drawObjects(): void {
    const s = useGameStore.getState();
    const map = this.map;
    if (!map) return;
    const ts = map.tileSize;
    const g = this.g;
    g.clear();

    const project = s.active;
    if (!project) return;

    // 配線（機器の中心を結ぶ折れ線）
    for (const link of project.links) {
      const color = CABLE_COLOR[link.cable] ?? DEFAULT_CABLE_COLOR;
      const pts = link.path.map(([x, y]) => [x * ts + ts / 2, y * ts + ts / 2]);
      g.moveTo(pts[0][0], pts[0][1]);
      for (const [x, y] of pts.slice(1)) g.lineTo(x, y);
      g.stroke({ width: 3, color });
    }

    // 配線のドラッグ中の線
    if (this.wireFrom) {
      const from = project.nodes.find((n) => n.uid === this.wireFrom);
      if (from) {
        g.moveTo(from.x * ts + ts / 2, from.y * ts + ts / 2);
        g.lineTo(this.wireTo.x, this.wireTo.y);
        g.stroke({ width: 2, color: SELECT });
      }
    }

    for (const node of project.nodes) this.drawNode(node, ts, s.selectedUid === node.uid);
  }

  private drawNode(node: NetNode, ts: number, selected: boolean): void {
    const g = this.g;
    const category = gameEnv.devices[node.device]?.category ?? 'unknown';
    const pad = ts * 0.18;
    const x = node.x * ts + pad;
    const y = node.y * ts + pad;
    const size = ts - pad * 2;
    if (selected) {
      g.rect(x - 2, y - 2, size + 4, size + 4).stroke({ width: 2, color: SELECT });
    }
    g.rect(x, y, size, size).fill(CATEGORY_COLOR[category] ?? 0xffffff);
    g.rect(x, y, size, size).stroke({ width: node.locked ? 2 : 1, color: OUTLINE });
    // LED（ポートにIPアドレスがあれば緑、なければ黄色の「未設定」）
    const configured = node.interfaces.length > 0;
    g.rect(x + size - 5, y + 3, 3, 3).fill(configured ? 0x62d26f : 0xffcc33);
  }

  // マップの座標に変換する（拡大と配置の補正を除いた、タイルの座標系）
  private toMap(e: FederatedPointerEvent): { x: number; y: number } {
    return this.content.toLocal(e.global);
  }

  private nodeAt(tx: number, ty: number): NetNode | undefined {
    return useGameStore.getState().active?.nodes.find((n) => n.x === tx && n.y === ty);
  }

  private tileOf(p: { x: number; y: number }): { tx: number; ty: number } | null {
    if (!this.map) return null;
    const tx = Math.floor(p.x / this.map.tileSize);
    const ty = Math.floor(p.y / this.map.tileSize);
    if (tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height) return null;
    return { tx, ty };
  }

  private onDown = (e: FederatedPointerEvent): void => {
    const store = useGameStore.getState();
    const p = this.toMap(e);
    const tile = this.tileOf(p);
    if (!tile) return;
    const node = this.nodeAt(tile.tx, tile.ty);

    if (store.placing && !node) {
      const error = store.place(store.placing, tile.tx, tile.ty);
      if (!error) store.setPlacing(null);
      return;
    }
    if (node) {
      store.setSelected(node.uid);
      if (store.active?.phase === 'design') {
        this.wireFrom = node.uid;
        this.wireTo = p;
      }
      return;
    }
    store.setSelected(null);
  };

  private onMove = (e: FederatedPointerEvent): void => {
    if (!this.wireFrom) return;
    this.wireTo = this.toMap(e);
    this.drawObjects();
  };

  private onUp = (e: FederatedPointerEvent): void => {
    if (!this.wireFrom) return;
    const from = this.wireFrom;
    this.wireFrom = null;
    const tile = this.tileOf(this.toMap(e));
    const target = tile ? this.nodeAt(tile.tx, tile.ty) : undefined;
    if (target && target.uid !== from) {
      useGameStore.getState().connect(from, target.uid, useGameStore.getState().wireCable);
    }
    this.drawObjects();
  };

  private cancelWire = (): void => {
    this.wireFrom = null;
    this.drawObjects();
  };
}
