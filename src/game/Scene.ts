// キャンバスの描画と操作。マップ・機器・配線・社員を描き、クリックで配置・選択、ドラッグで配線する。
// 描画の状態は store から読むだけで、変更は store の操作を通して行う。
import { Application, Container, Graphics, Rectangle, type FederatedPointerEvent, type Ticker } from 'pixi.js';
import type { GameMap } from '../data/schema';
import { useGameStore } from '../stores/useGameStore';
import { gameEnv } from '../sim/env';
import type { Project } from '../sim/project';
import type { NetLink, NetNode } from '../network/types';
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
// 社員の服の色（2人を区別する）
const STAFF_SHIRT = [0x4f7cc4, 0xe0644f];
// 社員のコマ送りの間隔（ms）。ART.md の 4〜8 fps 相当
const FRAME_MS = 150;

export class Scene {
  private content = new Container();
  private tiles: Container | null = null;
  private tilesId: string | null = null;
  private map: GameMap | null = null;
  private g = new Graphics();
  // 配線をドラッグ中の起点と現在位置（マップの座標）
  private wireFrom: string | null = null;
  private wireTo = { x: 0, y: 0 };
  private elapsed = 0;
  private frame = -1;
  private unsubscribe: () => void;

  constructor(private app: Application) {
    app.stage.addChild(this.content);
    this.content.addChild(this.g);
    app.stage.eventMode = 'static';
    app.stage.on('pointerdown', this.onDown);
    app.stage.on('pointermove', this.onMove);
    app.stage.on('pointerup', this.onUp);
    app.stage.on('pointerupoutside', this.cancelWire);
    app.ticker.add(this.onTick);
    window.addEventListener('resize', this.layout);
    this.unsubscribe = useGameStore.subscribe(() => this.refresh());
    this.refresh();
  }

  destroy(): void {
    this.unsubscribe();
    window.removeEventListener('resize', this.layout);
    this.app.ticker.remove(this.onTick);
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

  // 社員のコマ送りのため、一定の間隔でだけ描き直す
  private onTick = (ticker: Ticker): void => {
    this.elapsed += ticker.deltaMS;
    const frame = Math.floor(this.elapsed / FRAME_MS);
    if (frame === this.frame) return;
    this.frame = frame;
    if (useGameStore.getState().active?.phase === 'build') this.drawObjects();
  };

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
    const building = project.phase === 'build';
    const isBuilt = (uid: string, kind: 'nodes' | 'links') => project.built[kind].includes(uid);

    // 配線（機器の中心を結ぶ折れ線）。施工前の配線は半透明にする
    for (const link of project.links) {
      const color = CABLE_COLOR[link.cable] ?? DEFAULT_CABLE_COLOR;
      const alpha = building && !isBuilt(link.uid, 'links') ? 0.5 : 1;
      const pts = link.path.map(([x, y]) => [x * ts + ts / 2, y * ts + ts / 2]);
      g.moveTo(pts[0][0], pts[0][1]);
      for (const [x, y] of pts.slice(1)) g.lineTo(x, y);
      g.stroke({ width: 3, color, alpha });
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

    for (const node of project.nodes) {
      const dim = building && !isBuilt(node.uid, 'nodes');
      this.drawNode(node, ts, s.selectedUid === node.uid, dim);
    }

    if (building) this.drawBuilding(project, ts);
  }

  private drawNode(node: NetNode, ts: number, selected: boolean, dim: boolean): void {
    const g = this.g;
    const category = gameEnv.devices[node.device]?.category ?? 'unknown';
    const alpha = dim ? 0.5 : 1;
    const pad = ts * 0.18;
    const x = node.x * ts + pad;
    const y = node.y * ts + pad;
    const size = ts - pad * 2;
    if (selected) {
      g.rect(x - 2, y - 2, size + 4, size + 4).stroke({ width: 2, color: SELECT, alpha });
    }
    g.rect(x, y, size, size).fill({ color: CATEGORY_COLOR[category] ?? 0xffffff, alpha });
    g.rect(x, y, size, size).stroke({ width: node.locked ? 2 : 1, color: OUTLINE, alpha });
    // LED（ポートにIPアドレスがあれば緑、なければ黄色）
    const configured = node.interfaces.length > 0;
    g.rect(x + size - 5, y + 3, 3, 3).fill({ color: configured ? 0x62d26f : 0xffcc33, alpha });
  }

  // 施工中の社員と進捗バー。施工前の機器と配線を順に回る
  private drawBuilding(project: Project, ts: number): void {
    const g = this.g;
    const pending: { x: number; y: number }[] = [];
    for (const n of project.nodes) {
      if (!project.built.nodes.includes(n.uid)) pending.push({ x: n.x * ts + ts / 2, y: n.y * ts + ts / 2 });
    }
    for (const l of project.links) {
      if (!project.built.links.includes(l.uid)) pending.push(midpoint(l, ts));
    }
    const fraction = project.total > 0 ? Math.min(1, project.progress / project.total) : 1;
    const index = pending.length === 0 ? 0 : Math.min(pending.length - 1, Math.floor(fraction * pending.length));
    // 2人の社員は並んで作業する。足踏みのコマで上下に揺れる
    const bob = Math.floor(this.elapsed / FRAME_MS) % 2;
    const workers = Math.min(2, gameEnv.balance.staff.initialCount);
    for (let k = 0; k < workers && pending.length > 0; k++) {
      const at = pending[Math.min(pending.length - 1, index + k)];
      // 1人目は機器の左、2人目は右に立つ
      this.drawStaff(at.x + (k === 0 ? -18 : 2), at.y - 24 - bob, STAFF_SHIRT[k % STAFF_SHIRT.length]);
    }

    // 施工の進捗バー（マップの下端）
    const barW = (this.map?.width ?? 1) * ts;
    const barY = (this.map?.height ?? 1) * ts + 2;
    g.rect(0, barY, barW, 3).fill({ color: OUTLINE });
    g.rect(0, barY, barW * fraction, 3).fill({ color: SELECT });
  }

  // 社員のドット絵（16×24 px）。頭・髪・服の3色で、輪郭は単色
  private drawStaff(x: number, y: number, shirt: number): void {
    const g = this.g;
    g.rect(x + 4, y, 8, 8).fill(0xf6cfa8);
    g.rect(x + 4, y, 8, 3).fill(0x4a3530);
    g.rect(x + 2, y + 9, 12, 9).fill(shirt);
    g.rect(x + 3, y + 18, 4, 6).fill(0x3b2a33);
    g.rect(x + 9, y + 18, 4, 6).fill(0x3b2a33);
    g.rect(x + 2, y + 9, 12, 15).stroke({ width: 1, color: OUTLINE });
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

// 配線の中点（社員が作業する位置）
const midpoint = (link: NetLink, ts: number): { x: number; y: number } => {
  const a = link.path[0];
  const b = link.path[link.path.length - 1];
  return { x: ((a[0] + b[0]) / 2) * ts + ts / 2, y: ((a[1] + b[1]) / 2) * ts + ts / 2 };
};
