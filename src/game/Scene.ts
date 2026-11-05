// キャンバスの描画と操作。マップ・機器・配線・社員・パケットを描き、クリックで配置・選択、ドラッグで配線する。
// 描画の状態は store から読むだけで、変更は store の操作を通して行う。
import { Application, Container, Graphics, Rectangle, Sprite, Text, type FederatedPointerEvent, type Ticker } from 'pixi.js';
import type { GameMap } from '../data/schema';
import { editNetOf, focusedProject, frontDeviceUid, netTargetOf, useGameStore, type Trace, type WireStart } from '../stores/useGameStore';
import { linkAt } from './linkHit';
import { portLabel } from '../components/devicePorts';
import { rangeTiles } from './effectRange';
import { gameEnv } from '../sim/env';
import { checkConnect, compiledNet, DESK_ID, type PlacedFurniture, type Project } from '../sim/project';
import { colorOfLink, networkColors, type NetworkColors } from '../network/netColor';
import type { Compiled, IssueDetail } from '../network/compile';
import { texture } from './sprites';
import { balance, devices as deviceData } from 'virtual:game-data';
import { hideTip, showTipAt } from '../components/Tooltip';
import { effectText } from './effectText';
import { t } from '../i18n/t';
import type { LangKey } from '../generated/lang-keys';
import type { FailureReason, NetLink, NetNode } from '../network/types';
import { drawTileMap, layoutIntegerScale } from './TileMap';
import { cumulativeLengths, pointAt, type Point } from './animation';
import { wanderStep, type Walker } from './wander';

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
// PCを載せる位置（天板の中ほど。タイル上端からの距離。furniture/desk.png に合わせる）
const DESK_TOP = 18;
// 社員のスプライト（16×24）の足元（上端からの位置）
const STAFF_FOOT = 23;
// 機器の押す判定（画面上の一辺。マスが小さいときは、この大きさまで広げる）
const NODE_HIT_SCREEN_PX = 44;
// 撤去の道具で、マウスを乗せた対象を赤みがかった明るさにする
const HOT_RED = 0xff6b6b;
const REMOVE_TINT = 0xffb0b0;

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
  // カーソルのあるマス（配置の範囲の表示に使う）
  private cursorTile: { tx: number; ty: number } | null = null;
  private wireTo = { x: 0, y: 0 };
  // 配線の到達先の判定（接続できるか、理由）
  private hover: { uid: string; reason: string | null } | null = null;
  // マウスを乗せている配線（撤去できる配線だけ。太く明るく描く）、機器、家具（撤去の道具のとき）
  private hoverLinkUid: string | null = null;
  private hoverNodeUid: string | null = null;
  private hoverFurnUid: string | null = null;
  // 経過時間（ms）と、コマ送りの番号
  private elapsed = 0;
  private frame = -1;
  // 検収のパケット。新しい結果が来たら、その時刻からすべての経路に同時に流す
  private traces: Trace[] = [];
  private traceStart = 0;
  // 配線と設定から生成したネットワーク（不備の表示に使う）
  private compiled: Compiled | null = null;
  // ケーブルの色（ネットワークアドレスごと）。表示だけに使う
  private netColors: NetworkColors | null = null;
  // 席のない社員（自社オフィスを歩き回る）。位置は保存しない
  private wanderers: Walker[] = [];
  // 失敗の「？」の押せる範囲（機器の uid → マップの座標の矩形）。描き直すたびに作る
  private helpRects = new Map<string, { x: number; y: number; w: number; h: number }>();
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
    app.stage.on('pointerupoutside', this.dropWire);
    app.canvas.addEventListener('pointerleave', this.onCanvasLeave);
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
    this.app.stage.off('pointerupoutside', this.dropWire);
    this.app.canvas.removeEventListener('pointerleave', this.onCanvasLeave);
    this.resetTip();
    this.app.canvas.removeEventListener('contextmenu', this.preventMenu);
  }

  private preventMenu = (e: Event): void => e.preventDefault();

  // 表示する案件（受注中、または納品の結果を表示中）。なければ自社オフィスを表示する
  private project(): Project | null {
    const s = useGameStore.getState();
    return focusedProject(s) ?? s.showcase ?? this.officeView(s.office);
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
      testedOk: false,
      due: null,
      crew: [],
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
    this.netColors = this.compiled ? networkColors(this.compiled.net, gameEnv.engine) : null;
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
    this.updateWanderers(ticker.deltaMS);
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
      // ケーブルはネットワークアドレスの色で描く（未設定・食い違いは灰色）
      const color = this.netColors ? colorOfLink(this.netColors, link.uid) : 0x9a9a9a;
      const alpha = building && !isBuilt(link.uid, 'links') ? 0.5 : 1;
      const pts = link.path.map(([x, y]) => [x * ts + ts / 2, y * ts + ts / 2]);
      // マウスを乗せた配線は太く明るく描く
      const hot = link.uid === this.hoverLinkUid;
      // 撤去の道具では赤みがかった明るさにする
      const hotColor = s.tool === 'remove' ? mixColor(color, HOT_RED, 0.5) : brighten(color);
      g.moveTo(pts[0][0], pts[0][1]);
      for (const [x, y] of pts.slice(1)) g.lineTo(x, y);
      g.stroke({ width: hot ? 6 : 3, color: hot ? hotColor : color, alpha: hot ? 1 : alpha });
    }

    // 配線の線。ドラッグ中、または起点を選んだあとは、起点の機器からカーソルまで伸ばす
    const wireUid = this.wireFrom ?? s.wireStart?.uid ?? null;
    const wireNode = wireUid ? project.nodes.find((n) => n.uid === wireUid) : undefined;
    if (wireNode) {
      this.g.moveTo(wireNode.x * ts + ts / 2, wireNode.y * ts + ts / 2);
      this.g.lineTo(this.wireTo.x, this.wireTo.y);
      this.g.stroke({ width: 2, color: SELECT });
      this.drawWireCost(wireNode, ts);
    }

    // 疎通テスト中の機器は LED を速く点滅させる
    const onPath = new Set(this.traceActive() ? this.traces.flatMap((tr) => tr.result.path) : []);
    const fastBlink = Math.floor(this.elapsed / 120) % 2 === 0;
    const slowBlink = Math.floor(this.elapsed / 600) % 2 === 0;

    // 自社オフィスの家具は、機材と同じ層で足元のY座標の順に重ねる
    if (map.id === 'hq') this.drawFurniture(s.office.furniture, ts);

    for (const node of project.nodes) {
      const dim = building && !isBuilt(node.uid, 'nodes');
      // 配線の起点に選んだ機器は、光る枠で選ばれた状態にする
      this.drawNode(node, ts, frontDeviceUid(s) === node.uid || s.wireStart?.uid === node.uid, dim, project, this.hoverNodeUid === node.uid);
      const blinkOn = onPath.has(node.uid) ? fastBlink : slowBlink;
      const issue = this.issueOf(node, project);
      this.drawLed(node, ts, blinkOn, issue?.reason === 'ip.unset');
      // IPアドレスのない機器の表示は drawAddresses で出す。そのほかの不備には「？」を出す
      if (issue && issue.reason !== 'ip.unset') this.drawBubble(node, ts, '?', WARN);
    }

    if (s.showIp) {
      this.drawAddresses(project, ts);
      this.drawPortNames(project, ts);
    }
    if (building) this.drawBuilding(project, ts);
    else if (this.map?.id === 'hq' && !s.showcase) {
      this.drawDeskStaff(ts);
      this.drawWanderers(ts);
    }
    else if (focusedProject(s)) this.drawIdleStaff(ts);
    for (const trace of this.traces) this.drawTrace(trace, ts);
    this.drawFailures(project, ts);
    this.drawHover(project, ts);
    this.drawEffectRange(ts);
    this.drawFlash(ts);
  }

  private clearBubbles(): void {
    for (const child of this.bubbles.removeChildren()) child.destroy();
  }

  // 設計中の案件の機器の不備（機器の uid で引く）。設計中でなければ undefined
  private issueOf(node: NetNode, project: Project): IssueDetail | undefined {
    if (project.phase !== 'design' || !focusedProject(useGameStore.getState())) return undefined;
    return this.compiled?.issues[node.uid];
  }

  // 機器のスプライトの上端（マップの座標）。机の上（PCや机の家具のマス）は天板の高さ、床に置いた機器は足元から
  private spriteTopOf(node: NetNode, ts: number): number {
    const onDesk = this.deskAt(node.x, node.y) || gameEnv.devices[node.device]?.category === 'pc';
    return (onDesk ? node.y * ts + DESK_TOP : node.y * ts + ts - DEVICE_FOOT_INSET) - 38;
  }

  // IPアドレスとプレフィックス長を、機器のスプライトの上端に重ねて出す。画面上の高さが約11pxになるよう拡大率で割る
  private drawAddresses(project: Project, ts: number): void {
    const compiled = this.compiled;
    if (!compiled) return;
    const scale = this.content.scale.x;
    // 画面上で 11 px の文字にする。拡大率で割り、解像度を拡大率と画面の密度に合わせて、にじませない
    const fontPx = 11 / scale;
    const dpr = window.devicePixelRatio || 1;
    // 上の段（Y座標の小さい機器）のラベルを前面に出すため、Y座標の大きい順に描く
    const nodes = [...compiled.net.nodes].sort((a, b) => b.y - a.y);
    for (const node of nodes) {
      const ips = node.interfaces.map((i) => `${i.ip}/${i.prefix}`);
      // IPアドレスのない機器は、未設定の印（灰色の「IP ---」）だけを出す
      const unset = ips.length === 0 && compiled.issues[node.uid]?.reason === 'ip.unset';
      if (ips.length === 0 && !unset) continue;
      // 3行を超えるときは2行に抑え、残りを「ほか n件」にまとめる
      const lines = unset ? [t('ui.ip.blank')] : ips.length > 3 ? [...ips.slice(0, 2), t('ui.ip.more', { count: ips.length - 2 })] : ips;
      const text = new Text({
        text: lines.join('\n'),
        // 背景は付けず、縁取りで文字を読めるようにする
        style: { fontFamily: 'monospace', fontSize: fontPx, fill: unset ? 0x9a9a9a : 0xf4f1e6, align: 'center', stroke: { color: OUTLINE, width: 2 / scale } },
        resolution: Math.max(2, scale * dpr),
      });
      text.anchor.set(0.5, 1);
      const bottom = this.spriteTopOf(node, ts) + 4;
      const cx = node.x * ts + ts / 2;
      text.position.set(cx, bottom);
      this.bubbles.addChild(text);
    }
    void project;
  }

  // 自社オフィスでは、社員が机の前でキーボードを打つ
  private drawDeskStaff(ts: number): void {
    // 席は、自社オフィスの机の家具を並び順に使う
    const desks = useGameStore
      .getState()
      .office.furniture.filter((f) => f.id === DESK_ID)
      .map((f): [number, number] => [f.x, f.y]);
    const staffList = useGameStore.getState().staff;
    const workers = Math.min(desks.length, staffList.length);
    for (let k = 0; k < workers; k++) {
      const [dx, dy] = desks[k];
      // 机の下の段に座り、打鍵に合わせて小さく揺れる
      const tap = Math.floor(this.elapsed / (FRAME_MS * 2) + k) % 2;
      this.drawStaff(dx * ts + (ts - 16) / 2, (dy + 1) * ts - 6 - tap, STAFF_SHIRT[k % STAFF_SHIRT.length]);
      // 口癖は、社員ごとにずらした周期で、60秒に3秒だけ頭上に出す（平均60秒に1回）
      const seconds = this.elapsed / 1000 + k * 23;
      if (seconds % 60 < 3) {
        const quirk = new Text({
          text: t(`staff.quirk.${staffList[k].quirk}` as LangKey),
          style: { fontFamily: 'sans-serif', fontSize: 11, fill: 0xf4f1e6, stroke: { color: OUTLINE, width: 3 } },
        });
        quirk.anchor.set(0.5, 1);
        quirk.position.set(dx * ts + ts / 2, dy * ts - 4);
        this.bubbles.addChild(quirk);
      }
    }
  }

  // 席の数を超えた社員は、歩き回る。人数に合わせて歩き手を増減し、床の上を歩かせる（自社オフィスのみ）
  private updateWanderers(dt: number): void {
    const map = this.map;
    if (!map || map.id !== 'hq') {
      this.wanderers = [];
      return;
    }
    const s = useGameStore.getState();
    const seats = s.office.furniture.filter((f) => f.id === DESK_ID).length;
    const count = Math.max(0, s.staff.length - seats);
    const floor: Point[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) if (map.legend[map.tiles[y][x]] === 'floor') floor.push({ x, y });
    }
    while (this.wanderers.length < count) {
      const start = floor.length ? floor[Math.floor(Math.random() * floor.length)] : { x: 0, y: 0 };
      this.wanderers.push({ x: start.x, y: start.y, path: [], pause: 0 });
    }
    this.wanderers.length = count;
    this.wanderers = this.wanderers.map((w) => wanderStep(w, dt, floor, Math.random));
  }

  private drawWanderers(ts: number): void {
    this.wanderers.forEach((w, k) => {
      this.drawStaff(w.x * ts + (ts - 16) / 2, w.y * ts + ts - 26, STAFF_SHIRT[k % STAFF_SHIRT.length]);
    });
  }

  // 設計中は、社員がマップの左上で待機する。失敗の内容は機器の上の印で示す
  private drawIdleStaff(ts: number): void {
    const bob = Math.floor(this.elapsed / (FRAME_MS * 3)) % 2;
    const workers = Math.min(2, useGameStore.getState().staff.length);
    for (let k = 0; k < workers; k++) {
      this.drawStaff(ts + k * 18, ts - 8 - (k === 0 ? bob : 1 - bob), STAFF_SHIRT[k % STAFF_SHIRT.length]);
    }
  }

  // 自社オフィスの家具。スプライトの下端をマスの下端に揃え、1マスより高い分は上へはみ出させる
  private drawFurniture(furniture: PlacedFurniture[], ts: number): void {
    for (const f of furniture) {
      const tex = texture(`furniture/${f.id}`);
      if (!tex) continue;
      const sprite = new Sprite(tex);
      sprite.position.set(f.x * ts + Math.round((ts - tex.width) / 2), (f.y + 1) * ts - tex.height);
      // 机の上に置いたPCより後ろに描く。撤去の道具でマウスを乗せた家具は赤みがかった明るさにする
      sprite.zIndex = (f.y + 1) * ts - DEVICE_FOOT_INSET - 1;
      sprite.tint = f.uid === this.hoverFurnUid ? REMOVE_TINT : 0xffffff;
      this.sprites.addChild(sprite);
    }
  }

  // 自社オフィスで、そのマスに机の家具があるか
  private deskAt(x: number, y: number): boolean {
    return (
      this.map?.id === 'hq' &&
      useGameStore.getState().office.furniture.some((f) => f.x === x && f.y === y && f.id === DESK_ID)
    );
  }

  // 機器をドット絵で描く。種類ごとに形を変え、ポートは下の辺に並べる（空きは白抜き、使用中は塗りつぶし）
  private drawNode(node: NetNode, ts: number, selected: boolean, dim: boolean, project: Project, hot: boolean): void {
    const g = this.g;
    const category = gameEnv.devices[node.device]?.category ?? 'unknown';
    const alpha = dim ? 0.5 : 1;
    const pad = ts * 0.18;
    const x = node.x * ts + pad;
    const y = node.y * ts + pad;
    const size = ts - pad * 2;
    const base = CATEGORY_COLOR[category] ?? 0xffffff;
    // 撤去の道具でマウスを乗せた機器は、赤みがかった明るさにする
    const body = hot ? mixColor(base, HOT_RED, 0.5) : base;
    if (selected) {
      g.rect(x - 2, y - 2, size + 4, size + 4).stroke({ width: 2, color: SELECT, alpha });
    }
    // 機器はスプライト（24×40）で描く。足元（底面の行）をタイルの下寄りに揃え、床に置いた影を添える
    const tex = texture(deviceData[node.device as keyof typeof deviceData]?.sprite ?? '');
    const foot = node.y * ts + ts - DEVICE_FOOT_INSET;
    if (tex) {
      const sprite = new Sprite(tex);
      // スプライトの底面の行（y=37）が足元に来る位置。PCは机の天板に載せ、影は付けない
      const deskTile = this.deskAt(node.x, node.y);
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
      sprite.tint = hot ? REMOVE_TINT : 0xffffff;
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

  // 状態LED（小さな点）。IPアドレスが未設定の機器は橙色の点を1秒周期でゆっくり点滅させ、設定済みの機器は緑の点を点灯させる。
  // そのほかの機器は、通信・待機を表す点滅（黄色）
  private drawLed(node: NetNode, ts: number, blinkOn: boolean, unset: boolean): void {
    const pad = ts * 0.18;
    const size = ts - pad * 2;
    const x = node.x * ts + pad + size - 5;
    const y = node.y * ts + pad + 3;
    if (unset) {
      const lit = Math.floor(this.elapsed / 500) % 2 === 0;
      this.g.rect(x, y, 2, 2).fill({ color: lit ? 0xff8c2a : OUTLINE });
    } else if (node.interfaces.length > 0) {
      this.g.rect(x, y, 2, 2).fill({ color: 0x62d26f });
    } else {
      this.g.rect(x, y, 2, 2).fill({ color: blinkOn ? WARN : OUTLINE });
    }
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
    const workers = Math.min(2, useGameStore.getState().staff.length);
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

    // 失敗した地点までの道のり。復路の失敗は往路の終点で止まる（失敗の印は drawFailures で機器の上に出す）
    const failure = trace.result.failure;
    let stop = total;
    if (failure) {
      const uids = trace.result.path;
      const idx = failure.reason === 'return.failed' ? uids.length - 1 : uids.indexOf(failure.node);
      stop = idx >= 0 && idx < nodeAt.length ? cumulative[nodeAt[idx]] : 0;
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

  }

  // テストと検収の失敗を、失敗した機器の上に「×」と理由の文で出す。「？」を押すと直し方を出す。
  // 機器ごとに最初の失敗だけを出す（経路が描けない失敗も出す）
  private drawFailures(project: Project, ts: number): void {
    this.helpRects.clear();
    const s = useGameStore.getState();
    const check = s.check;
    if (!check || check.projectId !== project.id || project.phase !== 'design' || !focusedProject(s)) return;
    const byNode = new Map<string, FailureReason>();
    for (const goal of check.goals) {
      for (const f of goal.failures) if (!byNode.has(f.node)) byNode.set(f.node, f.reason);
    }
    const scale = this.content.scale.x;
    const resolution = Math.max(2, scale * (window.devicePixelRatio || 1));
    // 画面上で 12 px の文字。縁取りは細く、背景は付けない
    const style = (fill: number, bold: boolean) => ({
      fontFamily: 'sans-serif',
      fontSize: 12 / scale,
      fontWeight: bold ? ('bold' as const) : ('normal' as const),
      fill,
      stroke: { color: OUTLINE, width: 2 / scale },
    });
    const gap = 3 / scale;
    for (const [uid, reason] of byNode) {
      const node = project.nodes.find((n) => n.uid === uid);
      if (!node) continue;
      const mark = new Text({ text: '×', style: style(FAIL, true), resolution });
      const message = new Text({ text: t(`error.${reason}` as LangKey), style: style(0xf4f1e6, false), resolution });
      const help = new Text({ text: t('ui.fail.help'), style: style(SELECT, true), resolution });
      const parts = [mark, message, help];
      const width = parts.reduce((sum, part) => sum + part.width, 0) + gap * (parts.length - 1);
      // IPアドレスの表示（機器の上端に重なる）の上に置く
      const labelLines = Math.min(3, Math.max(1, node.interfaces.length));
      const bottom = this.spriteTopOf(node, ts) + 4 - (labelLines * 13) / scale - gap;
      const cx = node.x * ts + ts / 2;
      let x = cx - width / 2;
      for (const part of parts) {
        part.anchor.set(0, 1);
        part.position.set(x, bottom);
        this.bubbles.addChild(part);
        x += part.width + gap;
      }
      this.helpRects.set(uid, {
        x: help.x - gap,
        y: bottom - help.height - gap,
        w: help.width + gap * 2,
        h: help.height + gap * 2,
      });
      // 「？」を押して開いたときは、直し方を機器の上に出す（2〜3行）
      if (s.helpUid === uid) {
        const fix = new Text({ text: t(`error.${reason}.fix` as LangKey), style: style(0xf4f1e6, false), resolution });
        const pad = 4 / scale;
        const boxW = fix.width + pad * 2;
        const boxH = fix.height + pad * 2;
        const boxX = cx - boxW / 2;
        const boxY = bottom - help.height - gap * 2 - boxH;
        const box = new Graphics().roundRect(boxX, boxY, boxW, boxH, 3 / scale).fill({ color: OUTLINE, alpha: 0.92 });
        this.bubbles.addChild(box);
        fix.anchor.set(0, 0);
        fix.position.set(boxX + pad, boxY + pad);
        this.bubbles.addChild(fix);
      }
    }
  }

  // 押した位置が失敗の「？」なら、その機器の uid を返す（マップの座標）
  private helpAt(p: { x: number; y: number }): string | undefined {
    for (const [uid, r] of this.helpRects) {
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return uid;
    }
    return undefined;
  }

  private tileSize(): number {
    return this.map?.tileSize ?? 32;
  }

  private flashActive(): boolean {
    const f = useGameStore.getState().flash;
    return f !== null && Date.now() - f.at < FLASH_MS;
  }

  // 配線の到達先: 接続できれば緑、できなければ赤の枠と×
  // 効果のある家具を配置中は、カーソルの位置から効果の範囲を半透明の緑で塗る（範囲のない家具は塗らない）
  private drawEffectRange(ts: number): void {
    const store = useGameStore.getState();
    if (!store.placing || focusedProject(store) || !this.cursorTile) return;
    const range = gameEnv.furniture?.[store.placing]?.effect?.range;
    if (range === undefined || !this.map) return;
    for (const { tx, ty } of rangeTiles(this.cursorTile.tx, this.cursorTile.ty, range, this.map.width, this.map.height)) {
      this.g.rect(tx * ts, ty * ts, ts, ts).fill({ color: 0x62d26f, alpha: 0.35 });
    }
  }

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

  // 機器を編集できる対象の機器（自社オフィス、または設計中の案件）。編集できなければ null
  private editNodes(): NetNode[] | null {
    return editNetOf(useGameStore.getState())?.nodes ?? null;
  }

  // 機器を押したと見なす範囲（画面で一辺 44 px 以上）の中で、中心が最も近い機器。拡大率で割って、マップの座標で判定する
  private nodeNear(p: { x: number; y: number }, nodes: readonly NetNode[]): NetNode | undefined {
    const ts = this.tileSize();
    const half = Math.max(ts / 2, NODE_HIT_SCREEN_PX / 2 / this.content.scale.x);
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

  private tileOf(p: { x: number; y: number }): { tx: number; ty: number } | null {
    if (!this.map) return null;
    const tx = Math.floor(p.x / this.map.tileSize);
    const ty = Math.floor(p.y / this.map.tileSize);
    if (tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height) return null;
    return { tx, ty };
  }

  // マップ上の説明。マウスは乗せてから、タッチは長押ししてから出す。説明の中身は、その時点の状態から作る
  private tipKey: string | null = null;
  private tipTimer: number | null = null;
  private tipHideTimer: number | null = null;
  private tipShown = false;

  // 機器・家具・社員の説明（マス単位）。なければ null
  private mapTipAt(tx: number, ty: number): { key: string; text: string } | null {
    const store = useGameStore.getState();
    const node = this.project()?.nodes.find((n) => n.x === tx && n.y === ty);
    if (node) {
      const ips = this.compiled?.net.nodes.find((n) => n.uid === node.uid)?.interfaces.map((i) => `${i.ip}/${i.prefix}`) ?? [];
      return { key: `n:${node.uid}`, text: [t(`device.${node.device}.name` as LangKey), ...ips].join('\n') };
    }
    if (!focusedProject(store) && !store.showcase) {
      // 席に座っている社員（机の並び順に、雇用の順で座る）
      const desks = store.office.furniture.filter((f) => f.id === DESK_ID);
      const k = desks.findIndex((f) => f.x === tx && f.y === ty);
      const member = k >= 0 ? store.staff[k] : undefined;
      if (member) {
        const lines = [t(member.name as LangKey), t(`staff.job.${member.job}` as LangKey), t('ui.staff.level', { level: member.level })];
        return { key: `s:${member.uid}`, text: lines.join('\n') };
      }
      const f = store.office.furniture.find((x) => x.x === tx && x.y === ty);
      if (f) {
        const lines = [t(`furniture.${f.id}.name` as LangKey), effectText(gameEnv.furniture?.[f.id]?.effect)];
        return { key: `f:${f.uid}`, text: lines.filter((l): l is string => l !== null).join('\n') };
      }
    }
    return null;
  }

  private showTip(text: string, x: number, y: number): void {
    this.tipShown = true;
    showTipAt({ x: x - 8, y: y - 8, w: 16, h: 16 }, text);
  }

  // 説明を消して、予約をやめる
  private resetTip(): void {
    if (this.tipTimer !== null) window.clearTimeout(this.tipTimer);
    if (this.tipHideTimer !== null) window.clearTimeout(this.tipHideTimer);
    this.tipTimer = null;
    this.tipHideTimer = null;
    if (this.tipShown) hideTip();
    this.tipShown = false;
    this.tipKey = null;
  }

  // マウス: 乗った機器が変わったら、説明を予約する（hoverMs のあとに出す）
  private updateTip(e: FederatedPointerEvent): void {
    const tile = this.tileOf(this.toMap(e));
    const hit = tile ? this.mapTipAt(tile.tx, tile.ty) : null;
    const key = hit?.key ?? null;
    if (key === this.tipKey) return;
    this.resetTip();
    this.tipKey = key;
    if (!hit) return;
    this.tipTimer = window.setTimeout(() => this.showTip(hit.text, e.clientX, e.clientY), balance.tooltip.hoverMs);
  }

  // タッチ: 押した機器の説明を、長押しのあとに出す
  private startTouchTip(e: FederatedPointerEvent): void {
    const tile = this.tileOf(this.toMap(e));
    const hit = tile ? this.mapTipAt(tile.tx, tile.ty) : null;
    this.resetTip();
    this.tipKey = hit?.key ?? null;
    if (!hit) return;
    this.tipTimer = window.setTimeout(() => this.showTip(hit.text, e.clientX, e.clientY), balance.tooltip.longPressMs);
  }

  // タッチを離したら、説明を少し残して消す
  private endTouchTip(): void {
    if (this.tipTimer !== null) window.clearTimeout(this.tipTimer);
    this.tipTimer = null;
    if (this.tipShown) this.tipHideTimer = window.setTimeout(() => this.resetTip(), balance.tooltip.touchHideMs);
  }

  private onCanvasLeave = (): void => {
    this.resetTip();
    if (this.hoverLinkUid !== null || this.hoverNodeUid !== null || this.hoverFurnUid !== null) {
      this.hoverLinkUid = null;
      this.hoverNodeUid = null;
      this.hoverFurnUid = null;
      this.drawObjects();
    }
  };

  // 右クリックで撤去できる配線: 自社オフィス、または案件の設計中の配線。なければ null
  private removableLinks(): readonly NetLink[] | null {
    const s = useGameStore.getState();
    if (s.active.length === 0 && !s.showcase) return s.office.links;
    const project = focusedProject(s);
    return project?.phase === 'design' ? project.links : null;
  }

  // マウスの位置にある撤去できる配線（マップの座標で判定し、拡大率を考慮する）
  private linkUnder(p: { x: number; y: number }): NetLink | undefined {
    const links = this.removableLinks();
    if (!links) return undefined;
    return linkAt(links, p.x, p.y, this.tileSize(), this.content.scale.x);
  }

  private onDown = (e: FederatedPointerEvent): void => {
    if (e.pointerType === 'touch') this.startTouchTip(e);
    const store = useGameStore.getState();
    const p = this.toMap(e);
    // 失敗の「？」を押すと直し方を開く（もう一度押すと閉じる）。ほかを押すと閉じる
    if (e.button !== 2) {
      const helpUid = this.helpAt(p);
      if (helpUid) {
        store.setHelpUid(store.helpUid === helpUid ? null : helpUid);
        return;
      }
      if (store.helpUid) store.setHelpUid(null);
    }
    const tile = this.tileOf(p);
    if (!tile) return;
    // 機器を編集できないとき（納品の結果や施工中）は何もしない
    const nodes = this.editNodes();
    if (!nodes) return;
    // 右クリックは、どの道具でも撤去する
    if (e.button === 2) {
      this.removeAt(p, nodes);
      return;
    }
    const node = this.nodeNear(p, nodes);
    // 機材を置く予定があり、機器でない場所を押したら置く（続けて置けるよう、配置モードはそのままにする）
    if (store.placing && !node) {
      store.place(store.placing, tile.tx, tile.ty);
      return;
    }
    switch (store.tool) {
      case 'select':
        // 機器を押すと、機器の画面を開く。ドラッグしても配線しない。空きマスでは何もしない（ウィンドウは×か Esc で閉じる）
        if (node) store.openWindow('device', node.uid);
        return;
      case 'remove':
        this.removeAt(p, nodes);
        return;
      case 'wire':
        this.wireDown(p, node);
        return;
    }
  };

  // 撤去する。押した位置の機器（とつながるケーブル）、家具、配線の順に、1つだけ撤去する
  private removeAt(p: { x: number; y: number }, nodes: readonly NetNode[]): void {
    const store = useGameStore.getState();
    const node = this.nodeNear(p, nodes);
    if (node) {
      store.removeNode(node.uid);
      return;
    }
    const tile = this.tileOf(p);
    const inOffice = store.active.length === 0 && !store.showcase;
    const furniture =
      inOffice && tile ? store.office.furniture.find((f) => f.x === tile.tx && f.y === tile.ty) : undefined;
    if (furniture) {
      store.removeFurniture(furniture.uid);
      return;
    }
    const link = this.linkUnder(p);
    if (link) store.removeLink(link.uid);
  }

  // 配線の道具で機器を押す。起点を選んだあとは、押した機器のポートの一覧を出す（相手の機器）。
  // 起点がなければドラッグを始める（離した機器と配線する。同じ機器で離したら、ポートの一覧を出す）。空きマスを押すと取り消す
  private wireDown(p: { x: number; y: number }, node: NetNode | undefined): void {
    const store = useGameStore.getState();
    if (!node) {
      store.cancelWire();
      this.wireFrom = null;
      this.hover = null;
      this.drawObjects();
      return;
    }
    if (store.wireStart) {
      this.openMenuAt(node);
      return;
    }
    store.cancelWire();
    this.wireFrom = node.uid;
    this.wireTo = p;
    this.hover = null;
  }

  // 機器の横にポートの一覧を出す。位置は画面の座標（マップの拡大率と配置を反映する）
  private openMenuAt(node: NetNode): void {
    const ts = this.tileSize();
    const at = this.content.toGlobal({ x: node.x * ts + ts, y: node.y * ts + ts / 2 });
    const rect = this.app.canvas.getBoundingClientRect();
    useGameStore.getState().openPortMenu(node.uid, rect.left + at.x + 6, rect.top + at.y - 12);
  }

  private onMove = (e: FederatedPointerEvent): void => {
    if (e.pointerType !== 'touch') this.updateTip(e);
    const p = this.toMap(e);
    this.cursorTile = this.tileOf(p);
    const store = useGameStore.getState();
    // 配線の途中でなければ、マウスを乗せた対象を覚える
    if (!this.wireFrom && !store.wireStart) {
      this.updateHover(e);
      if (store.placing) this.drawObjects();
      return;
    }
    this.wireTo = p;
    this.aim();
    this.drawObjects();
  };

  // 配線の到達先を判定する。接続できれば緑、できなければ赤の枠と×（理由は配線の判定と同じ）
  private aim(): void {
    const store = useGameStore.getState();
    const nodes = this.editNodes();
    // ドラッグ中はおまかせのポート、起点を選んだあとは起点のポートを使う
    const start: WireStart | null = this.wireFrom ? { uid: this.wireFrom, port: null } : store.wireStart;
    const target = start && nodes ? this.nodeNear(this.wireTo, nodes) : undefined;
    if (!start || !target || target.uid === start.uid) {
      this.hover = null;
      return;
    }
    const ports = this.wireFrom ? {} : { a: start.port ?? undefined };
    const reason = checkConnect(store, start.uid, target.uid, store.wireCable, gameEnv, netTargetOf(store), ports);
    this.hover = { uid: target.uid, reason };
  }

  // マウスを乗せた配線・機器・家具を覚え、変わったときだけ描き直す（配置中は強調しない）。
  // 撤去の道具では、押すと消える機器・家具・配線を赤みがかった明るさで示す
  private updateHover(e: FederatedPointerEvent): void {
    const store = useGameStore.getState();
    const p = this.toMap(e);
    const tile = this.tileOf(p);
    const removing = store.tool === 'remove' && !store.placing;
    const nodes = removing ? this.editNodes() : null;
    const node = nodes ? this.nodeNear(p, nodes) : undefined;
    const inOffice = store.active.length === 0 && !store.showcase;
    const furniture =
      removing && inOffice && tile ? store.office.furniture.find((f) => f.x === tile.tx && f.y === tile.ty) : undefined;
    const link = store.placing ? undefined : this.linkUnder(p);
    const next = { node: node?.uid ?? null, furniture: furniture?.uid ?? null, link: link?.uid ?? null };
    if (next.node === this.hoverNodeUid && next.furniture === this.hoverFurnUid && next.link === this.hoverLinkUid) return;
    this.hoverNodeUid = next.node;
    this.hoverFurnUid = next.furniture;
    this.hoverLinkUid = next.link;
    this.drawObjects();
  }

  private onUp = (e: FederatedPointerEvent): void => {
    if (e.pointerType === 'touch') this.endTouchTip();
    if (!this.wireFrom) return;
    const from = this.wireFrom;
    this.wireFrom = null;
    this.hover = null;
    const store = useGameStore.getState();
    const nodes = this.editNodes();
    const target = nodes ? this.nodeNear(this.toMap(e), nodes) : undefined;
    if (target && target.uid !== from) {
      // ドラッグで機器から機器へ離した場合は、両端とも「おまかせ」で配線する
      store.connect(from, target.uid, store.wireCable);
    } else if (target) {
      // 押して離した場合は、起点のポートの一覧を出す
      this.openMenuAt(target);
    }
    this.drawObjects();
  };

  private dropWire = (): void => {
    this.wireFrom = null;
    this.hover = null;
    this.drawObjects();
  };

  // 配線中のカーソルの横に、ケーブルの長さと費用を出す。カーソルが機器の上なら、その機器までの長さ
  private drawWireCost(from: NetNode, ts: number): void {
    const store = useGameStore.getState();
    const cable = gameEnv.cables[store.wireCable];
    const nodes = this.editNodes();
    const tile = this.tileOf(this.wireTo);
    if (!cable || !tile || !nodes) return;
    const end = this.nodeNear(this.wireTo, nodes);
    const length = Math.abs(from.x - (end?.x ?? tile.tx)) + Math.abs(from.y - (end?.y ?? tile.ty));
    if (length < 1) return;
    const cost = cable.pricePerLink + cable.pricePerTile * length;
    const scale = this.content.scale.x;
    const text = new Text({
      text: t('ui.wire.cost', { length, cost: cost.toLocaleString('ja-JP') }),
      style: { fontFamily: 'sans-serif', fontSize: 12 / scale, fill: 0xf4f1e6, stroke: { color: OUTLINE, width: 2 / scale } },
      resolution: Math.max(2, scale * (window.devicePixelRatio || 1)),
    });
    text.anchor.set(0, 1);
    text.position.set(this.wireTo.x + ts * 0.25, this.wireTo.y - ts * 0.25);
    this.bubbles.addChild(text);
  }

  // ケーブルの両端に、つないだポートの名前を小さく出す（IPの表示と同じく showIp のときだけ）
  private drawPortNames(project: Project, ts: number): void {
    const nodes = new Map(project.nodes.map((n) => [n.uid, n] as const));
    for (const link of project.links) {
      this.portName(nodes.get(link.a.node), link.a.port, link.path, ts);
      this.portName(nodes.get(link.b.node), link.b.port, [...link.path].reverse(), ts);
    }
  }

  // ポートの名前を1つ描く。path は、機器の点（先頭）から始まる折れ線。機器の中心から、ケーブルの向きへ少しずらして置く
  private portName(
    node: NetNode | undefined,
    port: number,
    path: readonly (readonly [number, number])[],
    ts: number,
  ): void {
    const [ax, ay] = path[0];
    const toward = path.find(([x, y]) => x !== ax || y !== ay);
    if (!node || !toward) return;
    const dx = toward[0] - ax;
    const dy = toward[1] - ay;
    const len = Math.hypot(dx, dy);
    const scale = this.content.scale.x;
    const text = new Text({
      text: portLabel(gameEnv.devices[node.device]?.category, port),
      style: { fontFamily: 'sans-serif', fontSize: 11 / scale, fill: 0xf4f1e6, stroke: { color: OUTLINE, width: 2 / scale } },
      resolution: Math.max(2, scale * (window.devicePixelRatio || 1)),
    });
    text.anchor.set(0.5, 0.5);
    text.position.set(ax * ts + ts / 2 + (dx / len) * ts * 0.3, ay * ts + ts / 2 + (dy / len) * ts * 0.3);
    this.bubbles.addChild(text);
  }
}

// 色を target へ amount（0〜1）の割合で混ぜる
const mixColor = (color: number, target: number, amount: number): number => {
  const mix = (shift: number): number => {
    const c = (color >> shift) & 0xff;
    const d = (target >> shift) & 0xff;
    return Math.round(c + (d - c) * amount) << shift;
  };
  return mix(16) | mix(8) | mix(0);
};

// 色を白に近づけて明るくする（マウスを乗せた配線に使う）
const brighten = (color: number): number => mixColor(color, 0xffffff, 0.5);

// 配線の中点（社員が作業する位置）
const midpoint = (link: NetLink, ts: number): Point => {
  const a = link.path[0];
  const b = link.path[link.path.length - 1];
  return { x: ((a[0] + b[0]) / 2) * ts + ts / 2, y: ((a[1] + b[1]) / 2) * ts + ts / 2 };
};
