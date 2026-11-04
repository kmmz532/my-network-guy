// キャンバスの描画と操作。マップ・機器・配線・社員・パケットを描き、クリックで配置・選択、ドラッグで配線する。
// 描画の状態は store から読むだけで、変更は store の操作を通して行う。
import { Application, Container, Graphics, Rectangle, Text, type FederatedPointerEvent, type Ticker } from 'pixi.js';
import type { GameMap } from '../data/schema';
import { useGameStore, type Trace } from '../stores/useGameStore';
import { gameEnv } from '../sim/env';
import type { Project } from '../sim/project';
import type { NetLink, NetNode } from '../network/types';
import { drawTileMap, layoutIntegerScale } from './TileMap';
import { cumulativeLengths, pointAt, type Point } from './animation';

const OUTLINE = 0x3b2a33;
const SELECT = 0xffd866;
const WARN = 0xffcc33;
const FAIL = 0xe84a4a;
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
// プロトコルごとのパケットの色（ART.md）
const PACKET_COLOR: Record<string, number> = {
  ping: 0xffffff,
  http: 0xff8fb0,
};
// 社員の服の色（2人を区別する）
const STAFF_SHIRT = [0x4f7cc4, 0xe0644f];
// 社員のコマ送りの間隔（ms）。ART.md の 4〜8 fps 相当
const FRAME_MS = 150;
// パケットの速さ（タイル/秒）と、粒の間隔（タイル）。粒の数は3つまで
const PACKET_TILES_PER_SEC = 3;
const PACKET_SPACING_TILES = 0.5;
const PACKET_COUNT = 3;

export class Scene {
  private content = new Container();
  private tiles: Container | null = null;
  private tilesId: string | null = null;
  private map: GameMap | null = null;
  private g = new Graphics();
  private bubbles = new Container();
  // 配線をドラッグ中の起点と現在位置（マップの座標）
  private wireFrom: string | null = null;
  private wireTo = { x: 0, y: 0 };
  // 経過時間（ms）と、コマ送りの番号
  private elapsed = 0;
  private frame = -1;
  // 疎通テストの表示。新しい結果が来たら、その時刻から動かす
  private trace: Trace | null = null;
  private traceStart = 0;
  private unsubscribe: () => void;

  constructor(private app: Application) {
    app.stage.addChild(this.content);
    this.content.addChild(this.g);
    this.content.addChild(this.bubbles);
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
    if (s.lastTrace !== this.trace) {
      this.trace = s.lastTrace;
      this.traceStart = this.elapsed;
    }
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

  private onTick = (ticker: Ticker): void => {
    this.elapsed += ticker.deltaMS;
    // パケットは滑らかに動かす。それ以外はコマ送り（ART.md）
    if (this.trace && this.traceActive()) {
      this.drawObjects();
      return;
    }
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

  private traceActive(): boolean {
    const path = this.tracePath();
    return path !== null && this.elapsed - this.traceStart < this.traceDuration(path);
  }

  // 疎通テストの経路（機器の中心の座標）
  private tracePath(): Point[] | null {
    const s = useGameStore.getState();
    const map = this.map;
    if (!this.trace || !s.active || !map) return null;
    const ts = map.tileSize;
    const pts: Point[] = [];
    for (const uid of this.trace.result.path) {
      const n = s.active.nodes.find((x) => x.uid === uid);
      if (n) pts.push({ x: n.x * ts + ts / 2, y: n.y * ts + ts / 2 });
    }
    return pts.length >= 2 ? pts : null;
  }

  // 粒が経路を動き切るまでの時間（ms）
  private traceDuration(path: Point[]): number {
    const ts = this.map?.tileSize ?? 32;
    const total = cumulativeLengths(path).at(-1) ?? 0;
    const spacing = PACKET_SPACING_TILES * ts * (PACKET_COUNT - 1);
    return ((total + spacing) / (PACKET_TILES_PER_SEC * ts)) * 1000;
  }

  private drawObjects(): void {
    const s = useGameStore.getState();
    const map = this.map;
    if (!map) return;
    const ts = map.tileSize;
    const g = this.g;
    g.clear();
    this.clearBubbles();

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

    // 疎通テスト中の機器は LED を速く点滅させる
    const onPath = new Set(this.trace && this.traceActive() ? this.trace.result.path : []);
    const fastBlink = Math.floor(this.elapsed / 120) % 2 === 0;
    const slowBlink = Math.floor(this.elapsed / 600) % 2 === 0;

    for (const node of project.nodes) {
      const dim = building && !isBuilt(node.uid, 'nodes');
      this.drawNode(node, ts, s.selectedUid === node.uid, dim);
      const blinkOn = onPath.has(node.uid) ? fastBlink : slowBlink;
      this.drawLed(node, ts, blinkOn);
      if (this.needsAttention(node, project)) this.drawBubble(node, ts, '?', WARN);
    }

    if (building) this.drawBuilding(project, ts);
    this.drawTrace(ts);
  }

  private clearBubbles(): void {
    for (const child of this.bubbles.removeChildren()) child.destroy();
  }

  // 機器の状態が不備のとき「？」を出す（IPアドレス未設定の端末・ルーター）
  private needsAttention(node: NetNode, project: Project): boolean {
    const category = gameEnv.devices[node.device]?.category;
    if (project.phase !== 'design') return false;
    if (category === 'l2_switch') return false;
    return node.interfaces.length === 0;
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
  }

  // LED（ポートにIPアドレスがあれば緑、なければ黄色）。点滅で通信や待機を表す
  private drawLed(node: NetNode, ts: number, on: boolean): void {
    const pad = ts * 0.18;
    const size = ts - pad * 2;
    const x = node.x * ts + pad + size - 5;
    const y = node.y * ts + pad + 3;
    const configured = node.interfaces.length > 0;
    const color = configured ? 0x62d26f : WARN;
    this.g.rect(x, y, 3, 3).fill({ color: on ? color : OUTLINE });
  }

  private drawBubble(node: NetNode, ts: number, mark: string, color: number): void {
    const text = new Text({
      text: mark,
      style: { fontFamily: 'sans-serif', fontSize: 12, fontWeight: 'bold', fill: color, stroke: { color: OUTLINE, width: 3 } },
    });
    text.anchor.set(0.5, 1);
    text.position.set(node.x * ts + ts / 2, node.y * ts - 2);
    this.bubbles.addChild(text);
  }

  // 施工中の社員と進捗バー。施工前の機器と配線を順に回る
  private drawBuilding(project: Project, ts: number): void {
    const g = this.g;
    const pending: Point[] = [];
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
      // 1人目は作業場所の左、2人目は右に立つ
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

  // 疎通テストの経路と、パケットの粒。失敗した地点で止まり「×」を出す
  private drawTrace(ts: number): void {
    const trace = this.trace;
    const path = this.tracePath();
    if (!trace || !path) return;
    const cumulative = cumulativeLengths(path);
    const total = cumulative[cumulative.length - 1];

    // 失敗した地点までの道のり。復路の失敗は往路の終点で止まる
    const failure = trace.result.failure;
    let stop = total;
    let failAt: Point | null = null;
    if (failure) {
      const uids = trace.result.path;
      const idx = failure.reason === 'return.failed' ? uids.length - 1 : uids.indexOf(failure.node);
      if (idx >= 0 && idx < path.length) {
        stop = cumulative[idx];
        failAt = path[idx];
      } else {
        stop = 0;
        failAt = path[0];
      }
    }

    const elapsed = this.elapsed - this.traceStart;
    const travelled = (elapsed / 1000) * PACKET_TILES_PER_SEC * ts;
    const color = PACKET_COLOR[trace.kind] ?? 0xffffff;
    for (let i = 0; i < PACKET_COUNT; i++) {
      const d = Math.min(travelled - i * PACKET_SPACING_TILES * ts, stop);
      if (travelled - i * PACKET_SPACING_TILES * ts < 0) continue;
      const p = pointAt(path, cumulative, d);
      this.g.rect(p.x - 1.5, p.y - 1.5, 3, 3).fill({ color });
    }

    // 粒が失敗の地点に着いたら「×」を出す
    if (failAt && travelled >= stop) {
      const { x, y } = failAt;
      this.g.moveTo(x - 6, y - 6).lineTo(x + 6, y + 6).moveTo(x + 6, y - 6).lineTo(x - 6, y + 6);
      this.g.stroke({ width: 3, color: FAIL });
    }
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
const midpoint = (link: NetLink, ts: number): Point => {
  const a = link.path[0];
  const b = link.path[link.path.length - 1];
  return { x: ((a[0] + b[0]) / 2) * ts + ts / 2, y: ((a[1] + b[1]) / 2) * ts + ts / 2 };
};
