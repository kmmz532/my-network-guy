// キャンバスの描画と操作。マップ・機器・配線・社員・パケットを描き、クリックで配置・選択、ドラッグで配線する。
// 描画の状態は store から読むだけで、変更は store の操作を通して行う。
import { Application, Container, Graphics, Rectangle, Sprite, Text, type FederatedPointerEvent, type Ticker } from 'pixi.js';
import type { GameMap } from '../data/schema';
import { useGameStore, type Trace } from '../stores/useGameStore';
import { gameEnv } from '../sim/env';
import { checkConnect, compiledNet, type Project } from '../sim/project';
import type { Compiled } from '../network/compile';
import { subnetColor } from './palette';
import { texture } from './sprites';
import { devices as deviceData } from 'virtual:game-data';
import { t } from '../i18n/t';
import type { LangKey } from '../generated/lang-keys';
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
// 社員のスプライト（2人を服の色で区別する）
const STAFF_SHIRT = ['blue', 'red'];
// 社員のコマ送りの間隔（ms）。ART.md の 4〜8 fps 相当
const FRAME_MS = 150;
// 失敗の吹き出しを出しておく時間（ms）
const FLASH_MS = 2500;
// パケットの速さ（タイル/秒）と、粒の間隔（タイル）。粒の数は3つまで
const PACKET_TILES_PER_SEC = 3;
const PACKET_SPACING_TILES = 0.5;
const PACKET_COUNT = 3;
// 機器のスプライト（24×40）の足元は、タイルの下端から何 px 上か。足元のY座標で前後を決める
const DEVICE_FOOT_INSET = 4;
// 机の天板の手前の縁（タイル上端からの距離。furniture/desk.png に合わせる）
const DESK_TOP = 15;
// 社員のスプライト（16×24）の足元（上端からの位置）
const STAFF_FOOT = 23;

export class Scene {
  private content = new Container();
  private tiles: Container | null = null;
  private tilesId: string | null = null;
  private map: GameMap | null = null;
  // 配線（機器の下）、機器と社員のスプライト、ポート・色・パケットなどの重ね描き（機器の上）
  private bg = new Graphics();
  private sprites = new Container();
  private g = new Graphics();
  private bubbles = new Container();
  // 配線をドラッグ中の起点と現在位置（マップの座標）
  private wireFrom: string | null = null;
  private wireTo = { x: 0, y: 0 };
  // 配線の到達先の判定（接続できるか、理由）
  private hover: { uid: string; reason: string | null } | null = null;
  // 経過時間（ms）と、コマ送りの番号
  private elapsed = 0;
  private frame = -1;
  // 検収のパケット。新しい結果が来たら、その時刻からすべての経路に同時に流す
  private traces: Trace[] = [];
  private traceStart = 0;
  // 色と配線から生成したネットワーク（不備と色の表示に使う）
  private compiled: Compiled | null = null;
  private unsubscribe: () => void;

  constructor(private app: Application) {
    app.stage.addChild(this.content);
    this.content.addChild(this.bg);
    // 機器と社員は、足元のY座標（zIndex）の昇順に重ねる
    this.sprites.sortableChildren = true;
    this.content.addChild(this.sprites);
    this.content.addChild(this.g);
    this.content.addChild(this.bubbles);
    app.stage.eventMode = 'static';
    app.stage.on('pointerdown', this.onDown);
    app.stage.on('pointermove', this.onMove);
    app.stage.on('pointerup', this.onUp);
    app.stage.on('pointerupoutside', this.cancelWire);
    app.canvas.addEventListener('contextmenu', this.preventMenu);
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
    this.app.canvas.removeEventListener('contextmenu', this.preventMenu);
  }

  private preventMenu = (e: Event): void => e.preventDefault();

  // 表示する案件（受注中、または納品の結果を表示中）。なければ自社オフィスを表示する
  private project(): Project | null {
    const s = useGameStore.getState();
    return s.active ?? s.showcase ?? this.officeView(s.office);
  }

  private officeCache: { office: unknown; view: Project } | null = null;

  // 自社オフィスのネットワークを、表示用の案件として扱う
  private officeView(office: ReturnType<typeof useGameStore.getState>['office']): Project {
    if (this.officeCache?.office === office) return this.officeCache.view;
    const view: Project = {
      id: 'hq',
      kind: 'fixed',
      baseId: 'hq',
      params: {},
      contract: { id: 'hq', stage: 1, order: 0, requires: [], map: 'hq', budget: 0, placed: [], goals: [], reward: { money: 0, reputation: 0 }, inhouse: true },
      nodes: office.nodes,
      links: office.links,
      seq: office.seq,
      cost: 0,
      rework: 0,
      built: { nodes: office.nodes.map((n) => n.uid), links: office.links.map((l) => l.uid) },
      phase: 'design',
      progress: 0,
      total: 0,
    };
    this.officeCache = { office, view };
    return view;
  }

  // 表示するマップを選び、タイルを描き直す。マップが読み込まれていなければ何もしない
  private refresh(): void {
    const s = useGameStore.getState();
    if (s.traces !== this.traces) {
      this.traces = s.traces;
      this.traceStart = this.elapsed;
    }
    const shown = this.project();
    this.compiled = shown ? compiledNet(shown, gameEnv) : null;
    const mapId = shown?.contract.map ?? 'office_small';
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
    if (this.traceActive() || this.flashActive()) {
      this.drawObjects();
      return;
    }
    const frame = Math.floor(this.elapsed / FRAME_MS);
    if (frame === this.frame) return;
    this.frame = frame;
    // 社員はいつもコマ送りで動かす
    this.drawObjects();
  };

  private layout = (): void => {
    if (!this.map) return;
    this.app.stage.hitArea = new Rectangle(0, 0, this.app.screen.width, this.app.screen.height);
    layoutIntegerScale(this.content, this.map, this.app.screen.width, this.app.screen.height);
  };

  private traceActive(): boolean {
    return this.traces.some((trace) => {
      const route = this.tracePath(trace);
      return route !== null && this.elapsed - this.traceStart < this.traceDuration(route.pts);
    });
  }

  // 疎通テストの経路。ケーブルの折れ線に沿って点を並べ、各機器が点の何番目にあるかも返す
  private tracePath(trace: Trace): { pts: Point[]; nodeAt: number[] } | null {
    const project = this.project();
    const map = this.map;
    if (!project || !map) return null;
    const ts = map.tileSize;
    const center = (x: number, y: number): Point => ({ x: x * ts + ts / 2, y: y * ts + ts / 2 });
    const pts: Point[] = [];
    const nodeAt: number[] = [];
    let prev: string | null = null;
    for (const uid of trace.result.path) {
      const n = project.nodes.find((x) => x.uid === uid);
      if (!n) continue;
      if (prev) {
        const link = project.links.find(
          (l) => (l.a.node === prev && l.b.node === uid) || (l.b.node === prev && l.a.node === uid),
        );
        if (link) {
          const seg = link.path.map(([x, y]) => center(x, y));
          const oriented = link.a.node === prev ? seg : [...seg].reverse();
          pts.push(...oriented.slice(1));
        } else {
          pts.push(center(n.x, n.y));
        }
      } else {
        pts.push(center(n.x, n.y));
      }
      nodeAt.push(pts.length - 1);
      prev = uid;
    }
    return pts.length >= 2 ? { pts, nodeAt } : null;
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
    const g = this.bg;
    g.clear();
    this.g.clear();
    this.clearBubbles();
    this.sprites.removeChildren().forEach((c) => c.destroy());

    const project = this.project();
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
        this.g.moveTo(from.x * ts + ts / 2, from.y * ts + ts / 2);
        this.g.lineTo(this.wireTo.x, this.wireTo.y);
        this.g.stroke({ width: 2, color: SELECT });
      }
    }

    // 疎通テスト中の機器は LED を速く点滅させる
    const onPath = new Set(this.traceActive() ? this.traces.flatMap((tr) => tr.result.path) : []);
    const fastBlink = Math.floor(this.elapsed / 120) % 2 === 0;
    const slowBlink = Math.floor(this.elapsed / 600) % 2 === 0;

    for (const node of project.nodes) {
      const dim = building && !isBuilt(node.uid, 'nodes');
      this.drawNode(node, ts, s.selectedUid === node.uid, dim, project);
      const blinkOn = onPath.has(node.uid) ? fastBlink : slowBlink;
      this.drawLed(node, ts, blinkOn);
      this.drawColors(node, ts, dim);
      if (this.needsAttention(node, project)) this.drawBubble(node, ts, '?', WARN);
    }

    if (s.showIp) this.drawAddresses(project, ts);
    if (building) this.drawBuilding(project, ts);
    else if (this.map?.id === 'hq' && !s.showcase) this.drawDeskStaff(ts, s.hint);
    else if (s.active) this.drawIdleStaff(ts, s.hint);
    for (const trace of this.traces) this.drawTrace(trace, ts);
    this.drawHover(project, ts);
    this.drawFlash(ts);
  }

  private clearBubbles(): void {
    for (const child of this.bubbles.removeChildren()) child.destroy();
  }

  // 設計時点の不備（色の未設定・混在・ゲートウェイなし）があれば「？」を出す
  private needsAttention(node: NetNode, project: Project): boolean {
    if (project.phase !== 'design' || !useGameStore.getState().active) return false;
    return !!this.compiled?.issues[node.uid];
  }

  // サブネットの色。PC・サーバーは左上の札、ルーターはポート、スイッチはつながった色の帯
  private drawColors(node: NetNode, ts: number, dim: boolean): void {
    const g = this.g;
    const alpha = dim ? 0.5 : 1;
    const category = gameEnv.devices[node.device]?.category;
    const pad = ts * 0.18;
    const x = node.x * ts + pad;
    const y = node.y * ts + pad;
    const size = ts - pad * 2;
    const colors = node.colors ?? {};
    if (category === 'router') {
      const count = gameEnv.devices[node.device]?.portCount ?? 0;
      for (let port = 0; port < count; port++) {
        const c = colors[port];
        if (!c) continue;
        const px = x + ((port + 0.5) * size) / count - 3;
        g.rect(px, y + size + 4, 6, 4).fill({ color: subnetColor(c), alpha }).stroke({ width: 1, color: OUTLINE, alpha });
      }
      return;
    }
    const c = category === 'l2_switch' ? this.compiled?.switchColors[node.uid] : colors[0];
    if (!c) return;
    if (category === 'l2_switch') {
      g.rect(x, y + size * 0.3 - 3, size, 3).fill({ color: subnetColor(c), alpha });
    } else {
      g.rect(x - 3, y - 3, 7, 7).fill({ color: subnetColor(c), alpha }).stroke({ width: 1, color: OUTLINE, alpha });
    }
  }

  // 機器の名前と、色から割り当てたIPアドレスを機器の下に出す
  private drawAddresses(project: Project, ts: number): void {
    const compiled = this.compiled;
    if (!compiled) return;
    for (const node of compiled.net.nodes) {
      const lines = [node.uid.startsWith('u') ? '' : node.uid, ...node.interfaces.map((i) => i.ip)].filter(Boolean);
      if (!lines.length) continue;
      const text = new Text({
        text: lines.join('\n'),
        style: { fontFamily: 'monospace', fontSize: 9, fill: 0xf4f1e6, align: 'center', stroke: { color: OUTLINE, width: 3 } },
      });
      text.anchor.set(0.5, 0);
      text.position.set(node.x * ts + ts / 2, node.y * ts + ts + 2);
      this.bubbles.addChild(text);
    }
    void project;
  }

  // 自社オフィスでは、社員が机の前でキーボードを打つ
  private drawDeskStaff(ts: number, hint: string | null): void {
    const map = this.map!;
    const desks: [number, number][] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) if (map.legend[map.tiles[y][x]] === 'desk') desks.push([x, y]);
    }
    const workers = Math.min(desks.length, gameEnv.balance.staff.initialCount);
    for (let k = 0; k < workers; k++) {
      const [dx, dy] = desks[k];
      // 机の下の段に座り、打鍵に合わせて小さく揺れる
      const tap = Math.floor(this.elapsed / (FRAME_MS * 2) + k) % 2;
      this.drawStaff(dx * ts + (ts - 16) / 2, (dy + 1) * ts - 6 - tap, STAFF_SHIRT[k % STAFF_SHIRT.length]);
    }
    if (hint && desks.length) {
      const text = new Text({
        text: t(hint as LangKey),
        style: { fontFamily: 'sans-serif', fontSize: 11, fill: 0xf4f1e6, stroke: { color: OUTLINE, width: 3 } },
      });
      text.anchor.set(0.5, 1);
      text.position.set(desks[0][0] * ts + ts / 2, (desks[0][1] + 1) * ts - 10);
      this.bubbles.addChild(text);
    }
  }

  // 設計中は、社員がマップの左上で待機する。手戻りのときはヒントの吹き出しを出す
  private drawIdleStaff(ts: number, hint: string | null): void {
    const bob = Math.floor(this.elapsed / (FRAME_MS * 3)) % 2;
    const workers = Math.min(2, gameEnv.balance.staff.initialCount);
    for (let k = 0; k < workers; k++) {
      this.drawStaff(ts + k * 18, ts - 8 - (k === 0 ? bob : 1 - bob), STAFF_SHIRT[k % STAFF_SHIRT.length]);
    }
    const text = new Text({
      text: hint ? t(hint as LangKey) : '…',
      style: { fontFamily: 'sans-serif', fontSize: 11, fill: 0xf4f1e6, stroke: { color: OUTLINE, width: 3 } },
    });
    text.anchor.set(0, 1);
    text.position.set(ts, ts - 10);
    this.bubbles.addChild(text);
  }

  // 機器をドット絵で描く。種類ごとに形を変え、ポートは下の辺に並べる（空きは白抜き、使用中は塗りつぶし）
  private drawNode(node: NetNode, ts: number, selected: boolean, dim: boolean, project: Project): void {
    const g = this.g;
    const category = gameEnv.devices[node.device]?.category ?? 'unknown';
    const alpha = dim ? 0.5 : 1;
    const pad = ts * 0.18;
    const x = node.x * ts + pad;
    const y = node.y * ts + pad;
    const size = ts - pad * 2;
    const body = CATEGORY_COLOR[category] ?? 0xffffff;
    if (selected) {
      g.rect(x - 2, y - 2, size + 4, size + 4).stroke({ width: 2, color: SELECT, alpha });
    }
    // 機器はスプライト（24×40）で描く。足元（底面の行）をタイルの下寄りに揃え、床に置いた影を添える
    const tex = texture(deviceData[node.device as keyof typeof deviceData]?.sprite ?? '');
    const foot = node.y * ts + ts - DEVICE_FOOT_INSET;
    if (tex) {
      const sprite = new Sprite(tex);
      // スプライトの底面の行（y=37）が足元に来る位置。PCは机の天板（タイル上端から15 px）に載せ、影は付けない
      const deskTile = this.map?.legend[this.map.tiles[node.y]?.[node.x]] === 'desk';
      const onDesk = deskTile || category === 'pc';
      // 机のないマスに置いたPCには、机も一緒に描く
      const deskTex = !deskTile && category === 'pc' ? texture('furniture/desk') : undefined;
      if (deskTex) {
        const desk = new Sprite(deskTex);
        desk.position.set(node.x * ts, node.y * ts);
        desk.alpha = alpha;
        desk.zIndex = foot - 1;
        this.sprites.addChild(desk);
      }
      const base = onDesk ? node.y * ts + DESK_TOP : foot;
      sprite.position.set(node.x * ts + (ts - 24) / 2, base - 38);
      sprite.alpha = alpha;
      sprite.zIndex = foot;
      this.sprites.addChild(sprite);
      if (!onDesk) this.bg.ellipse(node.x * ts + ts / 2, foot, 10, 3).fill({ color: 0x000000, alpha: 0.25 * alpha });
    } else switch (category) {
      case 'pc':
        // モニターと台座
        g.rect(x + 2, y + 1, size - 4, size - 8).fill({ color: body, alpha });
        g.rect(x + 4, y + 3, size - 8, size - 12).fill({ color: 0x3b5f8a, alpha });
        g.rect(x + size / 2 - 2, y + size - 7, 4, 3).fill({ color: body, alpha });
        break;
      case 'server':
        // 縦長のラック。ドライブの線を入れる
        g.rect(x + 3, y, size - 6, size).fill({ color: body, alpha });
        for (const dy of [4, 10, 16]) g.rect(x + 5, y + dy, size - 10, 2).fill({ color: 0x5a6573, alpha });
        break;
      case 'l2_switch':
        // 横長の箱にポートの列
        g.rect(x, y + size * 0.3, size, size * 0.5).fill({ color: body, alpha });
        for (let i = 0; i < 4; i++) g.rect(x + 3 + i * 4, y + size * 0.5, 2, 3).fill({ color: 0x3b2a33, alpha });
        break;
      case 'router':
        // 箱とアンテナ
        g.moveTo(x + 4, y + size * 0.35).lineTo(x + 4, y).stroke({ width: 1, color: OUTLINE, alpha });
        g.moveTo(x + size - 4, y + size * 0.35).lineTo(x + size - 4, y).stroke({ width: 1, color: OUTLINE, alpha });
        g.rect(x, y + size * 0.35, size, size * 0.55).fill({ color: body, alpha });
        break;
      default:
        g.rect(x, y, size, size).fill({ color: body, alpha });
    }
    if (!tex) g.rect(x, y, size, size).stroke({ width: node.locked ? 2 : 1, color: OUTLINE, alpha });

    // ポート（下の辺）。使用中は塗りつぶし、空きは白抜き
    const count = gameEnv.devices[node.device]?.portCount ?? 0;
    const used = new Set<number>();
    for (const l of project.links) {
      if (l.a.node === node.uid) used.add(l.a.port);
      if (l.b.node === node.uid) used.add(l.b.port);
    }
    for (let port = 0; port < count; port++) {
      const px = x + ((port + 0.5) * size) / count - 2;
      const py = tex ? foot + 1 : y + size + 1;
      if (used.has(port)) {
        g.rect(px, py, 4, 3).fill({ color: OUTLINE, alpha });
      } else {
        g.rect(px, py, 4, 3).stroke({ width: 1, color: OUTLINE, alpha });
      }
    }
  }

  // LED（ポートにIPアドレスがあれば緑、なければ黄色）。点滅で通信や待機を表す
  private drawLed(node: NetNode, ts: number, on: boolean): void {
    const pad = ts * 0.18;
    const size = ts - pad * 2;
    const x = node.x * ts + pad + size - 5;
    const y = node.y * ts + pad + 3;
    const configured = Object.keys(node.colors ?? {}).length > 0;
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

  // 社員のスプライト（16×24 px）。2コマで足踏みする
  private drawStaff(x: number, y: number, shirt: string): void {
    const frame = Math.floor(this.elapsed / (FRAME_MS * 2)) % 2;
    const tex = texture(`staff/${shirt}_${frame}`);
    if (!tex) return;
    const sprite = new Sprite(tex);
    const left = Math.round(x);
    const top = Math.round(y);
    sprite.position.set(left, top);
    sprite.zIndex = top + STAFF_FOOT;
    this.sprites.addChild(sprite);
    // 足元の影（機器と同じく床に接地していることを示す）
    this.bg.ellipse(left + 8, top + STAFF_FOOT, 6, 2).fill({ color: 0x000000, alpha: 0.25 });
  }

  // 疎通テストの経路と、パケットの粒。失敗した地点で止まり「×」を出す
  private drawTrace(trace: Trace, ts: number): void {
    const route = this.tracePath(trace);
    if (!route) return;
    const { pts: path, nodeAt } = route;
    const cumulative = cumulativeLengths(path);
    const total = cumulative[cumulative.length - 1];

    // 失敗した地点までの道のり。復路の失敗は往路の終点で止まる
    const failure = trace.result.failure;
    let stop = total;
    let failAt: Point | null = null;
    if (failure) {
      const uids = trace.result.path;
      const idx = failure.reason === 'return.failed' ? uids.length - 1 : uids.indexOf(failure.node);
      if (idx >= 0 && idx < nodeAt.length) {
        stop = cumulative[nodeAt[idx]];
        failAt = path[nodeAt[idx]];
      } else {
        stop = 0;
        failAt = path[0];
      }
    }

    const elapsed = this.elapsed - this.traceStart;
    const travelled = (elapsed / 1000) * PACKET_TILES_PER_SEC * ts;
    const color = PACKET_COLOR[trace.kind] ?? 0xffffff;
    for (let i = 0; i < PACKET_COUNT; i++) {
      const behind = travelled - i * PACKET_SPACING_TILES * ts;
      if (behind < 0) continue;
      const p = pointAt(path, cumulative, Math.min(behind, stop));
      this.g.rect(p.x - 1.5, p.y - 1.5, 3, 3).fill({ color });
    }

    // 粒が失敗の地点に着いたら「×」を出す
    if (failAt && travelled >= stop) {
      const { x, y } = failAt;
      this.g.moveTo(x - 6, y - 6).lineTo(x + 6, y + 6).moveTo(x + 6, y - 6).lineTo(x - 6, y + 6);
      this.g.stroke({ width: 3, color: FAIL });
    }
  }

  private tileSize(): number {
    return this.map?.tileSize ?? 32;
  }

  private flashActive(): boolean {
    const f = useGameStore.getState().flash;
    return f !== null && Date.now() - f.at < FLASH_MS;
  }

  // 配線の到達先: 接続できれば緑、できなければ赤の枠と×
  private drawHover(project: Project, ts: number): void {
    if (!this.hover) return;
    const node = project.nodes.find((n) => n.uid === this.hover!.uid);
    if (!node) return;
    const ok = this.hover.reason === null;
    const color = ok ? 0x62d26f : FAIL;
    const x = node.x * ts;
    const y = node.y * ts;
    this.g.rect(x + 1, y + 1, ts - 2, ts - 2).stroke({ width: 2, color });
    if (!ok) {
      this.g.moveTo(x + 8, y + 8).lineTo(x + ts - 8, y + ts - 8).moveTo(x + ts - 8, y + 8).lineTo(x + 8, y + ts - 8);
      this.g.stroke({ width: 2, color: FAIL });
    }
  }

  // 操作の失敗を、失敗した地点に吹き出しで出す
  private drawFlash(ts: number): void {
    const f = useGameStore.getState().flash;
    if (!f || !this.flashActive()) return;
    const text = new Text({
      text: t(f.key as LangKey),
      style: { fontFamily: 'sans-serif', fontSize: 12, fill: 0xffd866, stroke: { color: OUTLINE, width: 3 } },
    });
    text.anchor.set(0.5, 1);
    text.position.set(f.tx * ts + ts / 2, f.ty * ts - 4);
    this.bubbles.addChild(text);
  }

  // マップの座標に変換する（拡大と配置の補正を除いた、タイルの座標系）
  private toMap(e: FederatedPointerEvent): { x: number; y: number } {
    return this.content.toLocal(e.global);
  }

  private nodeAt(tx: number, ty: number): NetNode | undefined {
    return useGameStore.getState().active?.nodes.find((n) => n.x === tx && n.y === ty);
  }

  // ルーターのどのポートを指したか（機器の幅をポート数で等分する）
  private portAt(node: NetNode, p: { x: number; y: number }): number {
    const count = gameEnv.devices[node.device]?.portCount ?? 1;
    const ts = this.tileSize();
    const rel = (p.x - node.x * ts) / ts;
    return Math.max(0, Math.min(count - 1, Math.floor(rel * count)));
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

    // 案件がなく、納品の結果も出ていないときは、自社オフィスに機材を置ける
    if (!store.active && !store.showcase) {
      const officeNode = store.office.nodes.find((n) => n.x === tile.tx && n.y === tile.ty);
      if (e.button === 2) {
        if (officeNode) store.removeNode(officeNode.uid);
      } else if (store.placing && !officeNode) {
        store.place(store.placing, tile.tx, tile.ty);
      } else {
        // 機器を選ぶと、設定パネルを開く
        store.setSelected(officeNode?.uid ?? null);
      }
      return;
    }
    if (store.active?.phase !== 'design') return;

    // 右クリックで撤去する
    if (e.button === 2) {
      if (node) store.removeNode(node.uid);
      return;
    }
    if (store.tool === 'paint') {
      if (!node) return;
      const category = gameEnv.devices[node.device]?.category;
      if (category === 'l2_switch') return;
      store.paint(node.uid, category === 'router' ? this.portAt(node, p) : 0);
      return;
    }
    if (store.placing && !node) {
      // 続けて置けるよう、配置モードはそのままにする
      store.place(store.placing, tile.tx, tile.ty);
      return;
    }
    if (node) {
      store.setSelected(node.uid);
      this.wireFrom = node.uid;
      this.wireTo = p;
      return;
    }
    store.setSelected(null);
  };

  private onMove = (e: FederatedPointerEvent): void => {
    if (!this.wireFrom) return;
    this.wireTo = this.toMap(e);
    const tile = this.tileOf(this.wireTo);
    const target = tile ? this.nodeAt(tile.tx, tile.ty) : undefined;
    if (target && target.uid !== this.wireFrom) {
      const store = useGameStore.getState();
      const reason = checkConnect(store, this.wireFrom, target.uid, store.wireCable, gameEnv);
      this.hover = { uid: target.uid, reason };
    } else {
      this.hover = null;
    }
    this.drawObjects();
  };

  private onUp = (e: FederatedPointerEvent): void => {
    if (!this.wireFrom) return;
    const from = this.wireFrom;
    this.wireFrom = null;
    this.hover = null;
    const tile = this.tileOf(this.toMap(e));
    const target = tile ? this.nodeAt(tile.tx, tile.ty) : undefined;
    if (target && target.uid !== from) {
      useGameStore.getState().connect(from, target.uid, useGameStore.getState().wireCable);
    }
    this.drawObjects();
  };

  private cancelWire = (): void => {
    this.wireFrom = null;
    this.hover = null;
    this.drawObjects();
  };
}

// 配線の中点（社員が作業する位置）
const midpoint = (link: NetLink, ts: number): Point => {
  const a = link.path[0];
  const b = link.path[link.path.length - 1];
  return { x: ((a[0] + b[0]) / 2) * ts + ts / 2, y: ((a[1] + b[1]) / 2) * ts + ts / 2 };
};
