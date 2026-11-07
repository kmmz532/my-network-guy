// キャンバスの描画と操作。マップ・機器・配線・社員・パケットを描き、クリックで配置・選択、ドラッグで配線する。
// 描画の状態は store から読むだけで、変更は store の操作を通して行う。
import { nodeLabel } from '../components/nodeLabel';
import { isPhoneNow } from '../ui/usePhone';
import { Application, Container, Graphics, Rectangle, Sprite, Text, type FederatedPointerEvent, type Ticker } from 'pixi.js';
import { staffSpriteName, STAFF_PLACEHOLDER_LOOKS, type GameMap } from '../data/schema';
import { coreOf, editNetOf, focusedProject, frontDeviceUid, netTargetOf, useGameStore, type Trace, type WireStart } from '../stores/useGameStore';
import { cableEndAt, linkAt, plugPoints } from './linkHit';
import { portLabel } from '../components/devicePorts';
import { isDragMove } from '../components/rearDrag';
import { rangeTiles } from './effectRange';
import { setMapView } from './mapView';
import { gameEnv } from '../sim/env';
import { moveFurniture, placeFurniture, seatedStaff, unseatedStaff } from '../sim/furniture';
import { spriteNameOf } from '../sim/facing';

// 向きの絵がある家具（机・椅子）。向きに合わせて絵を切り替える（N95）
const FACING_SPRITES = new Set(['furniture/desk', 'furniture/chair']);
// 向きに合わせて絵を変える機器（PC は机と同じ向きにする・N95）
const FACING_DEVICE_SPRITES = new Set(['device/pc_basic']);

// 席になる家具（机）かどうか（社員が座る）
const isDesk = (id: string): boolean => isDeskFurniture(id, gameEnv);
// PC のうち、机の上にしか置けないもの（deskable でない PC。N91）
const isPcOnlyDevice = (device: string): boolean => gameEnv.devices[device]?.category === CATEGORY.pc && gameEnv.devices[device]?.deskable !== true;
import { furnitureOf } from '../contracts/layout';
import { expandActionOf, expansionLocked, officeExpandCostOf, type ExpandSide } from '../sim/office';
import { levelOf } from '../sim/level';
import {
  checkConnect,
  compiledNet,
  isDeskFurniture,
  moveNode,
  placeDevice,
  placeInOffice,
  replugTo,
  type End,
  type PlacedFurniture,
  type Project,
} from '../sim/project';
import { colorOfLink, networkColors, type NetworkColors } from '../network/netColor';
import type { Compiled, IssueDetail } from '../network/compile';
import { spriteOf, texture, visibleTopOfSprite } from './sprites';
import { tileKind } from '../data/tileKind';
import { balance, devices as deviceData, furniture as furnitureData } from 'virtual:game-data';
import type { FurnitureId } from '../generated/ids';
import { hideTip, showTipAt } from '../components/Tooltip';
import { effectText } from './effectText';
import { t, tDyn } from '../i18n/t';
import type { FailureReason, NetLink, NetNode } from '../network/types';
import { CAP as WALL_CAP, drawTileMap } from './TileMap';
import { fitCamera, fitZoom, panCamera, resizeCamera, screenToMap, stepZoom, zoomCamera, type Camera, type Size } from './camera';
import { bindMapCommands } from './mapControl';
import { cumulativeLengths, pointAt, type Point } from './animation';
import { wanderStep, type Walker } from './wander';
import { bfsRoute, commuteStep, type Commute } from './commute';
import { breakMoveStep, deskMove, type BreakMove } from './breakMove';
import { breakAt, breakPlanOf } from '../sim/breaks';
import { isPresentOnShift, minuteInShift } from '../sim/shift';
import { minutesPerDay as dayMinutes } from '../sim/clock';
import { metersOf } from '../sim/cableLength';
import { deskStaffPos, deskTap, staffAt, STAFF_W, wanderStaffPos, type StaffHit } from './staffHit';
import { CATEGORY } from '../data/categories';

// 拡大・縮小ボタンの列は、ツールバーの上の右下の角にある（MapZoomButtons.tsx と同じ寸法。画面の px）
const ZOOM_BUTTON_W = 44;
const ZOOM_BUTTONS_H = 3 * 44 + 2 * 6;
const ZOOM_EDGE = 12;
const TOOLBAR_H = 56;
const TOOLBAR_H_PHONE = 84;

const OUTLINE = 0x3b2a33;
const SELECT = 0xffd866;
const WARN = 0xffcc33;
const FAIL = 0xe84a4a;
// プロトコルごとのパケットの色（ART.md）
const PACKET_COLOR: Record<string, number> = {
  ping: 0xffffff,
  http: 0xff8fb0,
};
// 社員のスプライト（2人を服の色で区別する）
// 社員のコマ送りの間隔（ms）。ART.md の 4〜8 fps 相当
const FRAME_MS = 150;
// 出勤・退勤で1フレームに歩かせる時間の上限（ms）
const COMMUTE_MAX_FRAME_MS = 100;
// 休憩の場所にする家具（自社オフィス）
const BREAK_FURNITURE = ['coffee', 'water', 'sofa'];
// サンドボックスを開いたとき（全体表示より大きい倍率）
// 椅子つきの机の ID と、椅子の絵・マスの下端からの位置（B10）
const CHAIR_FURNITURE = new Set(['desk']);
const CHAIR_SPRITE = 'furniture/chair';
const CHAIR_TOP_INSET = 4;
const SANDBOX_OPEN_ZOOM = 2;
// 失敗の吹き出しを出しておく時間（ms）
const FLASH_MS = 2500;
// つながった瞬間に、ケーブルの上を光が走る時間（ms）
const PULSE_MS = 450;
// 機器を押した瞬間の輪が広がる時間（ms）
const PRESS_MS = 220;
// 失敗の瞬間の揺れと赤い輪の時間（ms）
const SHAKE_MS = 320;
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
// 吹き出しの地（クリーム色）
const BUBBLE_FILL = 0xf4f1e6;
// 部屋を広げるボタン（「+」）の大きさは1マスの半分、文字は同じマスの0.75倍。通常は半透明で、マウスを乗せたときだけはっきり出す
const EXPAND_BUTTON_RATIO = 0.5;
const EXPAND_LABEL_RATIO = 0.75;
const EXPAND_IDLE_ALPHA = 0.45;
const EXPAND_SIDES: readonly ExpandSide[] = ['right', 'bottom', 'left'];
// 背景を長押ししてから動かせるようになるまで（ms）
const PAN_LONG_PRESS_MS = 300;
// 指で置いた機器・家具を持ち上げるまでの長押し（ms）。その前に TOUCH_PAN_PX 以上動けば、マップを移動する
const TOUCH_HOLD_MS = 400;
const TOUCH_PAN_PX = 8;
// ホイールの回転を、拡大・縮小1段階に換算する量（px。行単位のホイールは1行 16 px とする）
const WHEEL_STEP_PX = 40;
const WHEEL_LINE_PX = 16;
// 2本指で、指の間の距離がこの倍率を超えたら1段階拡大・縮小する
const PINCH_STEP_RATIO = 1.3;

// 機器・家具・ケーブルの端を押したあとの対象。動かさずに離せば押した扱い（click）、動かせばドラッグ
type PressTarget = { kind: 'node'; uid: string } | { kind: 'furniture'; uid: string } | { kind: 'end'; linkUid: string; end: End };
interface Press {
  // 押した位置（画面の座標）
  x0: number;
  y0: number;
  target: PressTarget;
  // 動かさずに離したときの処理
  click: () => void;
  // 動き出したか。動いたあとは、マップの座標の位置（at）を覚える
  dragging: boolean;
  at: Point | null;
  // 押した位置と最後の位置（画面の座標。pixi の global）。背景のドラッグに切り替えるときに使う
  g0: Point;
  last: Point;
  // 指で長押しするまで動かさない（機器・家具を指で押したとき）。timer は長押しの計時
  hold: boolean;
  timer: number | null;
}

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
  // 実時間の経過（ms）。ゲームの速度に関係なく進む（疎通テストの流れに使う。時間を止めていても流れが動く）
  private realElapsed = 0;
  // 配線と設定から生成したネットワーク（不備の表示に使う）
  private compiled: Compiled | null = null;
  // ケーブルの色（ネットワークアドレスごと）。表示だけに使う
  private netColors: NetworkColors | null = null;
  // 席のない社員（自社オフィスを歩き回る）。位置は保存しない
  private wanderers: Walker[] = [];
  // 机の社員の出勤・退勤の状態（キーは社員の uid）
  private commutes = new Map<string, Commute>();
  // 休憩の動き（キーは社員の uid。机にいる社員は desk）
  private breaks = new Map<string, BreakMove>();
  // 失敗の「？」の押せる範囲（機器の uid → マップの座標の矩形）。描き直すたびに作る
  private helpRects = new Map<string, { x: number; y: number; w: number; h: number }>();
  private unsubscribe: () => void;
  // マップの拡大・移動の状態（画面上の位置と倍率）と、画面の大きさ（最後に合わせた値）
  private camera: Camera | null = null;
  private view: Size = { w: 0, h: 0 };
  // ホイールの回転量の合計（拡大・縮小の1段階に達するまで溜める）
  private wheelAcc = 0;
  // 指の位置（canvas の座標）。2本になったらピンチ（拡大・2本指の移動）
  private touches = new Map<number, Point>();
  private pinch: { dist: number; mid: Point } | null = null;
  // 背景のドラッグ（移動）。長押しのあとに動き出す、または選択の道具で即座に動き出す
  private pan: { last: Point; active: boolean; timer: number | null } | null = null;
  // 任意の道具で、マウスを乗せている機器と配線（ポートの名前を出すときに使う）
  private hoverAnyNode: string | null = null;
  private hoverAnyLink: string | null = null;
  // 機器・家具・ケーブルの端を押している間の操作（動かすか、押して離すか）
  private press: Press | null = null;
  // 自社オフィスの部屋を広げるボタン（右・下・左の辺の外側）。描き直さず、位置と表示だけを更新する
  private expandButtons = new Map<ExpandSide, Container>();

  constructor(private app: Application) {
    // インベントリの欄（DOM）から、マスの判定と品目を置けるかを使えるようにする
    setMapView({ tileAtClient: (x, y) => this.tileAtClient(x, y), canPlace: (id, tx, ty) => this.canPlace(id, tx, ty) });
    window.addEventListener('keydown', this.onPressKey, true);
    window.addEventListener('pointermove', this.onWindowPointerMove);
    app.stage.addChild(this.content);
    this.content.addChild(this.bg);
    // 機器と社員は、足元のY座標（zIndex）の昇順に重ねる
    this.sprites.sortableChildren = true;
    this.content.addChild(this.sprites);
    this.content.addChild(this.g);
    this.content.addChild(this.bubbles);
    for (const side of EXPAND_SIDES) this.expandButtons.set(side, this.makeExpandButton(side));
    app.stage.eventMode = 'static';
    app.stage.on('pointerdown', this.onDown);
    app.stage.on('pointermove', this.onMove);
    app.stage.on('pointerup', this.onUp);
    app.stage.on('pointerupoutside', this.dropWire);
    // R キーで、マウスを乗せた家具（自社オフィスの机など）を90度回す（N95）
    window.addEventListener('keydown', this.onRotateKey);
    app.canvas.addEventListener('pointerleave', this.onCanvasLeave);
    app.canvas.addEventListener('contextmenu', this.preventMenu);
    // ホイールはブラウザの拡大・スクロールを止めるため passive を外す（Ctrl＋ホイールとピンチも、マップの拡大にする）
    app.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    app.canvas.addEventListener('mousedown', this.preventMiddleScroll);
    // 指の操作は、Pixi の操作より先に受け取る（捕捉の段階）。2本目の指で、配線などの操作を取り消す
    app.canvas.addEventListener('pointerdown', this.onCanvasPointerDown, true);
    app.canvas.addEventListener('pointermove', this.onCanvasPointerMove, true);
    app.canvas.addEventListener('pointerup', this.onCanvasPointerUp, true);
    app.canvas.addEventListener('pointercancel', this.onCanvasPointerUp, true);
    app.canvas.style.touchAction = 'none';
    app.ticker.add(this.onTick);
    this.unsubscribe = useGameStore.subscribe(() => this.refresh());
    bindMapCommands({
      zoomIn: () => this.zoomBy(1),
      zoomOut: () => this.zoomBy(-1),
      fit: () => this.fit(),
      pan: (dx, dy) => this.panBy(dx, dy),
    });
    this.refresh();
  }

  // R キーで、マウスを乗せた家具を回す（自社オフィスのみ）
  private onRotateKey = (e: KeyboardEvent): void => {
    if ((e.key !== 'r' && e.key !== 'R') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.hoverFurnUid === null || this.map?.id !== 'hq') return;
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    useGameStore.getState().rotateFurniture(this.hoverFurnUid);
  };

  destroy(): void {
    window.removeEventListener('keydown', this.onRotateKey);
    this.unsubscribe();
    setMapView(null);
    window.removeEventListener('keydown', this.onPressKey, true);
    window.removeEventListener('pointermove', this.onWindowPointerMove);
    bindMapCommands(null);
    this.endPan();
    this.clearPress();
    this.app.ticker.remove(this.onTick);
    this.app.canvas.removeEventListener('wheel', this.onWheel);
    this.app.canvas.removeEventListener('mousedown', this.preventMiddleScroll);
    this.app.canvas.removeEventListener('pointerdown', this.onCanvasPointerDown, true);
    this.app.canvas.removeEventListener('pointermove', this.onCanvasPointerMove, true);
    this.app.canvas.removeEventListener('pointerup', this.onCanvasPointerUp, true);
    this.app.canvas.removeEventListener('pointercancel', this.onCanvasPointerUp, true);
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
      contract: { id: 'hq', stage: 1, order: 0, unlockLevel: 1, requires: [], map: 'hq', budget: 0, placed: [], goals: [], reward: { money: 0 }, inhouse: true },
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
      // 自社オフィスのセグメントの設定も渡す（ケーブルの色とネットワークの判定に使う）
      segments: office.segments ?? {},
    };
    this.officeCache = { office, view };
    return view;
  }

  // 表示するマップを選び、タイルを描き直す。マップが読み込まれていなければ何もしない
  private refresh(): void {
    const s = useGameStore.getState();
    if (s.traces !== this.traces) {
      this.traces = s.traces;
      this.traceStart = this.realElapsed;
    }
    const shown = this.project();
    this.compiled = shown ? compiledNet(shown, gameEnv) : null;
    this.netColors = this.compiled ? networkColors(this.compiled.net, gameEnv.engine) : null;
    const mapId = shown?.contract.map ?? 'office_small';
    const map = s.maps[mapId];
    if (!map) return;
    // 自社オフィスの部屋は広げると作り直すため、同じIDでもマップが変わったら描き直す
    if (this.tilesId !== mapId || this.map !== map) {
      if (this.tiles) this.tiles.destroy({ children: true });
      this.tiles = drawTileMap(map);
      this.content.addChildAt(this.tiles, 0);
      this.tilesId = mapId;
      this.map = map;
      // マップが変わったら全体に合わせる
      this.camera = null;
      this.layout();
    }
    this.drawObjects();
    this.updateExpandButtons();
  }

  // 部屋を広げるボタン。部屋の外側に、広げられる辺だけ出す（受注中・納品の表示のときは出さない）
  private makeExpandButton(side: ExpandSide): Container {
    const box = new Container();
    box.eventMode = 'static';
    box.cursor = 'pointer';
    const body = new Graphics();
    const label = new Text({
      text: '+',
      style: { fontFamily: 'sans-serif', fontWeight: 'bold', fill: OUTLINE },
      resolution: this.textResolution(),
    });
    label.anchor.set(0.5);
    box.addChild(body, label);
    // 位置を決めるまでは出さない（マップの読み込み後に updateExpandButtons で表示する）
    box.visible = false;
    // 普段は半透明にして、マウスを乗せたときだけはっきり出す
    box.alpha = EXPAND_IDLE_ALPHA;
    // 押したときは、マップの操作（背景のドラッグなど）にしない
    box.on('pointerdown', (e) => {
      e.stopPropagation();
      this.resetTip();
      useGameStore.getState().expandOffice(side);
    });
    box.on('pointerover', (e) => {
      box.alpha = 1;
      this.resetTip();
      const office = useGameStore.getState().office;
      const action = expandActionOf(office, side, balance.office);
      const name = tDyn(`ui.office.${action === 'annex' ? 'annex' : 'expand'}.${side}`);
      const cost = t('ui.office.cost', { cost: officeExpandCostOf(office, balance.office).toLocaleString('ja-JP') });
      this.tipTimer = window.setTimeout(() => this.showTip(`${name}\n${cost}`, e.clientX, e.clientY), balance.tooltip.hoverMs);
    });
    box.on('pointerout', () => {
      box.alpha = EXPAND_IDLE_ALPHA;
      this.resetTip();
    });
    // 乗っている間も、マップの移動や配線の操作は続ける。ボタン上の移動では、説明を消さないよう伝えない
    box.on('pointermove', (e) => {
      if (!this.wireFrom && !this.pan && !this.press) e.stopPropagation();
    });
    // 拡張のボタンは吹き出しの下に置く（吹き出しの文字を隠さない・B5）。吹き出しより後に足すと上に出るため、吹き出しの位置に差し込む
    this.content.addChildAt(box, this.content.getChildIndex(this.bubbles));
    return box;
  }

  // 部屋を広げるボタンの位置と表示を、いまの部屋の大きさに合わせる（マップの座標）
  private updateExpandButtons(): void {
    const map = this.map;
    const s = useGameStore.getState();
    // サンドボックスは部屋を広げないので、広げるボタンは出さない
    // サンドボックスも、広げるボタンを出す（解放と費用を問わない。N59）
    const shown = s.active.length === 0 && !s.showcase && map?.id === 'hq';
    for (const side of EXPAND_SIDES) {
      const box = this.expandButtons.get(side);
      if (!box) continue;
      // 次の拡張が会社のレベルで解放されるまでは出さない（N59）
      const locked = s.mode !== 'sandbox' && expansionLocked(s.office, balance.office, levelOf(s.companyExp, balance));
      const visible = shown && !locked && expandActionOf(s.office, side, balance.office) !== null;
      box.visible = visible;
      if (!visible || !map) continue;
      const ts = map.tileSize;
      const mapW = map.width * ts;
      const mapH = map.height * ts;
      // 画素の格子に合わせて、整数の大きさと位置にする（線がにじまないように）
      const size = Math.round(ts * EXPAND_BUTTON_RATIO);
      // 壁の外側の線（TileMap は外側の壁のマスの、部屋側に寄った細い上面だけを描く）に、ボタンの端を接して置く。
      // 右と左は壁の中ほど、下は床の幅の中ほど
      const at =
        side === 'right' ? { x: mapW - ts + WALL_CAP, y: (mapH - size) / 2 }
        : side === 'left' ? { x: ts - WALL_CAP - size, y: (mapH - size) / 2 }
        : { x: (mapW - size) / 2, y: mapH - ts + WALL_CAP };
      box.position.set(Math.round(at.x), Math.round(at.y));
      const body = box.getChildAt(0) as Graphics;
      body.clear();
      // 角は少しだけ丸める。半径と線の太さは整数にして、角の丸みが歪んで見えないようにする
      const radius = Math.round(size / 8);
      body.roundRect(0, 0, size, size, radius).fill(BUBBLE_FILL).stroke({ width: 2, color: OUTLINE, alignment: 0 });
      const label = box.getChildAt(1) as Text;
      label.style.fontSize = size * EXPAND_LABEL_RATIO;
      label.position.set(size / 2, size / 2);
    }
  }

  private onTick = (ticker: Ticker): void => {
    // 疎通テストの流れ（粒）は実時間で進める。時間を止めていても（設計中など）流れが動く
    this.realElapsed += ticker.deltaMS;
    // ゲームの速度（一時停止は 0）に合わせて、社員の移動・アニメーション・つぶやきの時間を進める
    const dt = ticker.deltaMS * useGameStore.getState().speed;
    this.elapsed += dt;
    // 画面の大きさが変わったら、マップの位置と倍率を合わせ直す（resize の順に関係なく、描画の時点で拾う）
    const view = this.viewSize();
    if (this.map && (view.w !== this.view.w || view.h !== this.view.h)) this.layout();
    this.updateWanderers(dt);
    this.updateCommutes(dt);
    // パケットは滑らかに動かす。それ以外はコマ送り（ART.md）
    if (this.traceActive() || this.flashActive() || this.pulseActive() || this.pressActive()) {
      this.drawObjects();
      return;
    }
    const frame = Math.floor(this.elapsed / FRAME_MS);
    if (frame === this.frame) return;
    this.frame = frame;
    // 社員はいつもコマ送りで動かす
    this.drawObjects();
  };

  // マップの位置と倍率を、画面に合わせる。マップが変わったときは全体、画面の大きさが変わったときは倍率を保って合わせ直す（R1）
  private layout = (): void => {
    if (!this.map) return;
    this.app.stage.hitArea = new Rectangle(0, 0, this.app.screen.width, this.app.screen.height);
    const view = this.viewSize();
    const map = this.mapSize();
    // 全体表示のときは、画面の大きさに合わせて測り直す（ヘッダーとツールバーの分を除く）
    this.camera = this.camera && !this.camera.fit ? resizeCamera(this.camera, map, this.view, view) : this.fitCameraOf(view);
    this.view = view;
    this.applyCamera();
  };

  private viewSize(): Size {
    return { w: this.app.screen.width, h: this.app.screen.height };
  }

  // マップの大きさ（マップの座標の px。拡大率は含まない）
  private mapSize(): Size {
    const ts = this.tileSize();
    return { w: (this.map?.width ?? 0) * ts, h: (this.map?.height ?? 0) * ts };
  }

  private viewCenter(): Point {
    return { x: this.view.w / 2, y: this.view.h / 2 };
  }

  // 位置と倍率を描画に反映し、描き直す（文字の大きさは倍率で割るため、画面上では同じ大きさになる）
  private applyCamera(): void {
    const cam = this.camera;
    if (!cam) return;
    this.content.scale.set(cam.zoom);
    this.content.position.set(cam.x, cam.y);
    this.drawObjects();
  }

  private setCamera(next: Camera): void {
    const cam = this.camera;
    if (cam && next.zoom === cam.zoom && next.x === cam.x && next.y === cam.y && next.fit === cam.fit) return;
    this.camera = next;
    this.applyCamera();
  }

  // 拡大（1）・縮小（-1）を1段階。anchor（画面の座標）の下のマップの点は動かさない。省略時は画面の中央
  private zoomBy(dir: 1 | -1, anchor: Point = this.viewCenter()): void {
    const cam = this.camera;
    if (!cam) return;
    this.setCamera(zoomCamera(cam, this.mapSize(), this.view, stepZoom(cam.zoom, dir), anchor));
  }

  private fit(): void {
    if (this.map) this.setCamera(this.fitCameraOf(this.view));
  }

  // 全体表示で避ける画面の端の分（画面の px）。上はヘッダー、下はツールバー
  private fitInsets(): { top: number; bottom: number } {
    const canvas = this.app.canvas.getBoundingClientRect();
    const header = document.querySelector('header')?.getBoundingClientRect();
    const bar = document.querySelector('[data-toolbar]')?.getBoundingClientRect();
    const top = header && header.height > 0 ? Math.max(0, header.bottom - canvas.top) : 0;
    const bottom = bar && bar.height > 0 ? Math.max(0, canvas.bottom - bar.top) : 0;
    return { top, bottom };
  }

  // 拡大・縮小ボタンの列の位置（画面の px）。右下の角で、ツールバーの上に置く
  private zoomButtonsRect(view: Size): { left: number; top: number; right: number; bottom: number } {
    const toolbar = isPhoneNow() ? TOOLBAR_H_PHONE : TOOLBAR_H;
    const right = view.w - ZOOM_EDGE;
    const bottom = view.h - toolbar - ZOOM_EDGE;
    return { left: right - ZOOM_BUTTON_W, top: bottom - ZOOM_BUTTONS_H, right, bottom };
  }

  // 全体に合わせた位置と倍率。自社オフィスは、辺の外側の「+」ボタンが画面に収まるよう、周りを1マス分あける（マップは中央に置く）。
  // 自社オフィスは、ヘッダーとツールバーの分を除いた範囲に、余白を含めて収まる最大の倍率にする。
  // 拡大・縮小ボタンの列と重なるときだけ、上へずらし、それでも重なるなら左へずらす
  private fitCameraOf(view: Size): Camera {
    const map = this.mapSize();
    if (this.map?.id !== 'hq') return fitCamera(map, view);
    const pad = this.tileSize();
    const padded = { w: map.w + pad * 2, h: map.h + pad * 2 };
    const insets = this.fitInsets();
    const area = { w: view.w, h: Math.max(0, view.h - insets.top - insets.bottom) };
    // サンドボックスは全体表示だと機器が小さすぎるため、開いたときは部屋の一部を拡大する
    const zoom = useGameStore.getState().mode === 'sandbox' ? Math.max(fitZoom(padded, area), SANDBOX_OPEN_ZOOM) : fitZoom(padded, area);
    const boxW = padded.w * zoom;
    const boxH = padded.h * zoom;
    let left = (area.w - boxW) / 2;
    let top = insets.top + (area.h - boxH) / 2;
    const col = this.zoomButtonsRect(view);
    const overlaps = left < col.right && left + boxW > col.left && top < col.bottom && top + boxH > col.top;
    if (overlaps) {
      const up = col.top - boxH;
      if (up >= insets.top) top = up;
      else if (col.left - boxW >= 0) left = col.left - boxW;
    }
    return {
      zoom,
      x: Math.round(left + pad * zoom),
      y: Math.round(top + pad * zoom),
      fit: true,
    };
  }

  private panBy(dx: number, dy: number): void {
    const cam = this.camera;
    if (!cam) return;
    this.setCamera(panCamera(cam, this.mapSize(), this.view, dx, dy));
  }

  // canvas の中の位置（CSS の px）
  private canvasPoint(e: { clientX: number; clientY: number }): Point {
    const rect = this.app.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private preventMiddleScroll = (e: MouseEvent): void => {
    if (e.button === 1) e.preventDefault();
  };

  // ホイール・Ctrl＋ホイール・トラックパッドのピンチは、カーソルの位置を中心に拡大・縮小する。ブラウザの拡大は起こさない
  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * WHEEL_LINE_PX : e.deltaY;
    this.wheelAcc += dy;
    if (Math.abs(this.wheelAcc) < WHEEL_STEP_PX) return;
    const dir = this.wheelAcc < 0 ? 1 : -1;
    this.wheelAcc = 0;
    this.zoomBy(dir, this.canvasPoint(e));
  };

  // 指の追跡。2本になったらピンチを始める（拡大・縮小と、2本指の移動）
  private onCanvasPointerDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    this.touches.set(e.pointerId, this.canvasPoint(e));
    if (this.touches.size === 2) this.startPinch();
  };

  private onCanvasPointerMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' || !this.touches.has(e.pointerId)) return;
    this.touches.set(e.pointerId, this.canvasPoint(e));
    if (this.pinch && this.touches.size === 2) this.updatePinch();
  };

  private onCanvasPointerUp = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinch = null;
  };

  // 2本の指の距離と中点を覚え、配線などの途中の操作と背景のドラッグを取り消す
  private startPinch(): void {
    const [a, b] = [...this.touches.values()];
    this.endPan();
    this.clearPress();
    this.resetTip();
    this.wireFrom = null;
    this.hover = null;
    useGameStore.getState().cancelWire();
    this.pinch = { dist: distOf(a, b), mid: midOf(a, b) };
    this.drawObjects();
  }

  private updatePinch(): void {
    const pinch = this.pinch;
    if (!pinch) return;
    const [a, b] = [...this.touches.values()];
    const dist = distOf(a, b);
    const mid = midOf(a, b);
    if (dist >= 1 && dist > pinch.dist * PINCH_STEP_RATIO) {
      this.zoomBy(1, mid);
      pinch.dist = dist;
    } else if (dist >= 1 && dist * PINCH_STEP_RATIO < pinch.dist) {
      this.zoomBy(-1, mid);
      pinch.dist = dist;
    }
    this.panBy(mid.x - pinch.mid.x, mid.y - pinch.mid.y);
    pinch.mid = mid;
  }

  // 背景のドラッグを始める。immediate なら即座に動き出し、そうでなければ長押しのあとに動き出す
  private beginPan(e: FederatedPointerEvent, immediate: boolean): void {
    this.beginPanAt({ x: e.global.x, y: e.global.y }, immediate);
  }

  // 画面の座標の位置（at）から背景のドラッグを始める
  private beginPanAt(at: Point, immediate: boolean): void {
    this.endPan();
    const pan: { last: Point; active: boolean; timer: number | null } = {
      last: at,
      active: immediate,
      timer: null,
    };
    if (!immediate) {
      pan.timer = window.setTimeout(() => {
        pan.timer = null;
        if (this.pan === pan) pan.active = true;
      }, PAN_LONG_PRESS_MS);
    }
    this.pan = pan;
  }

  private endPan(): void {
    if (this.pan?.timer != null) window.clearTimeout(this.pan.timer);
    this.pan = null;
  }

  // 背景のドラッグ中は動かす。動き出す前は、基準の位置だけを更新する。動かしたときは true
  private movePan(e: FederatedPointerEvent): boolean {
    const pan = this.pan;
    if (!pan) return false;
    const p = { x: e.global.x, y: e.global.y };
    if (pan.active) this.panBy(p.x - pan.last.x, p.y - pan.last.y);
    pan.last = p;
    return pan.active;
  }

  // 押した位置が背景か（機器・家具・ケーブル・社員のない場所。マップの外の余白を含む）
  private isBackground(p: Point, tile: { tx: number; ty: number } | null): boolean {
    if (!tile) return true;
    const project = this.project();
    if (project && (this.nodeNear(p, project.nodes) || linkAt(project.links, p.x, p.y, this.tileSize(), this.content.scale.x))) return false;
    if (staffAt(this.officeStaffHits(), p)) return false;
    const store = useGameStore.getState();
    if (this.map?.id === 'hq' && store.office.furniture.some((f) => f.x === tile.tx && f.y === tile.ty)) return false;
    return true;
  }

  private traceActive(): boolean {
    return this.traces.some((trace) => {
      const route = this.tracePath(trace);
      return route !== null && this.realElapsed - this.traceStart < this.traceDuration(route.pts);
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

    // つながった瞬間の光（配線の上に描く）
    this.drawLinkPulse(project, ts);
    // 押した機器の輪
    this.drawPressFx(project, ts);

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
    // 依頼先の家具（机・棚・飾り。N76）は、地図の固定の家具と合わせて描く
    else this.drawFurniture(furnitureOf(map.furniture, project.contract.furniture), ts);

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

    // 失敗の表示があるときは、その機器のIPの表示を出さない（重なるため）
    const failing = this.failureNodes(project);
    if (s.showIp) {
      this.drawAddresses(project, ts, failing);
      this.drawPortNames(project, ts);
    }
    if (building) this.drawBuilding(project, ts);
    else if (this.map?.id === 'hq' && !s.showcase) {
      this.drawDeskStaff(ts);
      this.drawWanderers(ts);
    }
    for (const trace of this.traces) this.drawTrace(trace, ts);
    this.drawFailures(project, ts, failing);
    this.drawPlugMarks(ts);
    this.drawHover(project, ts);
    this.drawEffectRange(ts);
    this.drawPlacePreview(ts);
    this.drawDrag(ts);
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
    // サンドボックスでは、PC は机の上に限らず床に置ける（天板の高さに上げない）
    const onDesk = this.deskAt(node.x, node.y) || (isPcOnlyDevice(node.device) && useGameStore.getState().mode !== 'sandbox');
    return (onDesk ? node.y * ts + DESK_TOP : node.y * ts + ts - DEVICE_FOOT_INSET) - 38;
  }

  // IPアドレスとプレフィックス長を、機器のスプライトの上端に重ねて出す。画面上の高さが約11pxになるよう拡大率で割る
  private drawAddresses(project: Project, ts: number, failing: ReadonlyMap<string, FailureReason>): void {
    const compiled = this.compiled;
    if (!compiled) return;
    const scale = this.content.scale.x;
    // 画面上で 11 px の文字にする。拡大率で割り、解像度を拡大率と画面の密度に合わせて、にじませない
    const fontPx = 11 / scale;
    const dpr = window.devicePixelRatio || 1;
    // 上の段（Y座標の小さい機器）のラベルを前面に出すため、Y座標の大きい順に描く
    const nodes = [...compiled.net.nodes].sort((a, b) => b.y - a.y);
    for (const node of nodes) {
      // IPアドレスが2つ以上ある機器（スイッチ付きルーターの WAN と LAN）は、ポート名を添えて1行ずつ読めるようにする
      const category = gameEnv.devices[node.device]?.category;
      const ips = node.interfaces.map((i) => (node.interfaces.length > 1 ? `${portLabel(category, i.port)} ${i.ip}/${i.prefix}` : `${i.ip}/${i.prefix}`));
      // IPアドレスのない機器は、未設定の印（灰色の「IP ---」）だけを出す
      const unset = ips.length === 0 && compiled.issues[node.uid]?.reason === 'ip.unset';
      if (ips.length === 0 && !unset) continue;
      // 失敗の表示が出ている機器は、IPの表示を出さない
      if (failing.has(node.uid)) continue;
      // 3行を超えるときは2行に抑え、残りを「ほか n件」にまとめる
      const lines = unset ? [t('ui.ip.blank')] : ips.length > 3 ? [...ips.slice(0, 2), t('ui.ip.more', { count: ips.length - 2 })] : ips;
      const text = new Text({
        text: lines.join('\n'),
        // 背景は付けず、縁取りで文字を読めるようにする
        // 行の高さを文字の大きさの1.3倍にし、行どうしが重ならないようにする
        style: { fontFamily: 'monospace', fontSize: fontPx, lineHeight: fontPx * 1.3, fill: unset ? 0x9a9a9a : 0xf4f1e6, align: 'center', stroke: { color: OUTLINE, width: 2 / scale } },
        resolution: Math.max(2, scale * dpr),
      });
      text.anchor.set(0.5, 1);
      // 画像の上の透明な部分を飛ばし、見えている部分の上にラベルを置く（PCは上の透明部が多いため）
      const visibleTop = visibleTopOfSprite(deviceData[node.device as keyof typeof deviceData]?.sprite ?? '');
      const bottom = this.spriteTopOf(node, ts) + visibleTop + 4;
      const cx = node.x * ts + ts / 2;
      text.position.set(cx, bottom);
      this.bubbles.addChild(text);
    }
    void project;
  }

  // 自社オフィスでは、社員が机の前でキーボードを打つ
  private drawDeskStaff(ts: number): void {
    // 社員は、自分の机（家具）に座る。机のない社員は歩き回る（drawWanderers）
    const s = useGameStore.getState();
    seatedStaff(s.office, s.staff, isDesk).forEach(({ member, desk }, k) => {
      const look = member.look;
      const c = this.commutes.get(member.uid);
      // 退勤して外にいる社員は描かない。出勤・退勤の途中は、通路を歩く姿を描く（机の前の打鍵はしない）
      if (c?.state === 'away') return;
      // 休憩の途中（場所へ歩く・休む・戻る）は、その位置に立って描く（机の前の打鍵はしない）
      const b = this.breaks.get(member.uid);
      if (c?.state === 'seated' && b && b.phase !== 'desk') {
        const at = wanderStaffPos(b.at.x, b.at.y, ts);
        this.drawStaff(at.x, at.y, look, member);
        return;
      }
      if (c && c.state !== 'seated') {
        const at = wanderStaffPos(c.at.x, c.at.y, ts);
        this.drawStaff(at.x, at.y, look, member);
        return;
      }
      // 机の下の段に座り、打鍵に合わせて小さく揺れる
      const at = deskStaffPos(desk.x, desk.y, ts, deskTap(this.elapsed, k));
      this.drawStaff(at.x, at.y, look, member);
      // 口癖は、社員ごとにずらした周期で、60秒に3秒だけ頭上に出す（平均60秒に1回）
      const seconds = this.elapsed / 1000 + k * 23;
      if (seconds % 60 < 3) {
        this.drawSpeech(tDyn(`staff.quirk.${member.quirk}`), at.x + STAFF_W / 2, at.y);
      }
    });
  }

  // 机の社員の出勤と退勤。終業（workEndHour）になると机からドアへ歩いて外に出て、始業（workStartHour）になるとドアから机へ歩いて入る（自社オフィスのみ）
  private updateCommutes(dt: number): void {
    const map = this.map;
    if (!map || map.id !== 'hq') return;
    const s = useGameStore.getState();
    // 出社は始業の少し前から（席に着いているのは始業まで）。事務所にいる時刻の間は、出勤の途中か机にいる
    // 出入り口は、マップの最初のドアのマス。ドアがない最初の部屋では、下の壁の手前の中央の床を出入り口にする
    let door: Point = { x: Math.floor(map.width / 2), y: map.height - 2 };
    outer: for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (tileKind(map, x, y) === 'door') {
          door = { x, y };
          break outer;
        }
      }
    }
    const passable = (x: number, y: number): boolean => {
      const kind = tileKind(map, x, y);
      return kind === 'floor' || kind === 'door';
    };
    const route = (from: Point, to: Point): Point[] | null => bfsRoute(from, to, passable);
    const seated = seatedStaff(s.office, s.staff, isDesk);
    // 休憩の場所（コーヒー・水・ソファ）。なければ、床の数か所を歩き回る
    const restSpots = s.office.furniture.filter((f) => BREAK_FURNITURE.includes(f.id)).map((f): Point => ({ x: f.x, y: f.y }));
    const floor: Point[] = [];
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (tileKind(map, x, y) === 'floor') floor.push({ x, y });
    const minuteOfDay = s.clock.minute % dayMinutes;
    const day = Math.floor(s.clock.minute / dayMinutes);
    const frameDt = Math.min(dt, COMMUTE_MAX_FRAME_MS);
    const seen = new Set<string>();
    seated.forEach(({ member, desk: f }, k) => {
      seen.add(member.uid);
      // 出社と退社は、社員の勤務の区分（日勤・夜勤）で決まる（N48）
      const present = isPresentOnShift(minuteOfDay, member.shift, balance);
      const cur = this.commutes.get(member.uid) ?? { state: present ? 'seated' : 'away', at: { x: f.x, y: f.y }, path: [] };
      // 1フレームで進みすぎないよう、歩かせる時間を上限で抑える（フレームが飛んだときに一気に歩き終えない）
      const next = commuteStep(cur, frameDt, present, { x: f.x, y: f.y }, door, route);
      this.commutes.set(member.uid, next);
      // 休憩は、机にいる社員だけ。休憩の場所は、社員ごとに決まった場所（なければ床の決まった場所）
      const plan = breakPlanOf(member.uid, day, balance, member.shift);
      const onBreak = next.state === 'seated' && breakAt(minuteInShift(minuteOfDay, member.shift, balance), plan) !== null;
      const spot =
        restSpots.length > 0
          ? restSpots[k % restSpots.length]
          : (floor[(k * 7) % Math.max(1, floor.length)] ?? { x: f.x, y: f.y });
      const prev = this.breaks.get(member.uid) ?? deskMove({ x: f.x, y: f.y });
      this.breaks.set(
        member.uid,
        next.state === 'seated' ? breakMoveStep(prev, frameDt, onBreak, { x: f.x, y: f.y }, spot, route) : deskMove({ x: f.x, y: f.y }),
      );
    });
    for (const uid of [...this.commutes.keys()]) if (!seen.has(uid)) this.commutes.delete(uid);
    for (const uid of [...this.breaks.keys()]) if (!seen.has(uid)) this.breaks.delete(uid);
  }

  // 席の数を超えた社員は、歩き回る。人数に合わせて歩き手を増減し、床の上を歩かせる（自社オフィスのみ）
  private updateWanderers(dt: number): void {
    const map = this.map;
    if (!map || map.id !== 'hq') {
      this.wanderers = [];
      return;
    }
    const s = useGameStore.getState();
    const count = unseatedStaff(s.office, s.staff, isDesk).length;
    const floor: Point[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const kind = tileKind(map, x, y);
        if (kind === 'floor' || kind === 'door') floor.push({ x, y });
      }
    }
    while (this.wanderers.length < count) {
      const start = floor.length ? floor[Math.floor(Math.random() * floor.length)] : { x: 0, y: 0 };
      this.wanderers.push({ x: start.x, y: start.y, path: [], pause: 0 });
    }
    this.wanderers.length = count;
    this.wanderers = this.wanderers.map((w) => wanderStep(w, dt, floor, Math.random));
  }

  private drawWanderers(ts: number): void {
    // 歩き手は、机のない社員（officeStaffHits と同じ並び）
    const s = useGameStore.getState();
    const unseated = unseatedStaff(s.office, s.staff, isDesk);
    this.wanderers.forEach((w, k) => {
      const at = wanderStaffPos(w.x, w.y, ts);
      const member = unseated[k];
      this.drawStaff(at.x, at.y, member?.look ?? STAFF_PLACEHOLDER_LOOKS[k % STAFF_PLACEHOLDER_LOOKS.length], member);
    });
  }

  // 自社オフィスに描いている社員の位置と uid。席の社員は席の順（雇用の順）、歩き回る社員は席の数の後の社員
  // 描いていないとき（納品の結果、施工中、ほかのマップ）は空
  private officeStaffHits(): StaffHit[] {
    const s = useGameStore.getState();
    if (this.map?.id !== 'hq' || s.showcase || focusedProject(s)?.phase === 'build') return [];
    const ts = this.tileSize();
    const hits: StaffHit[] = [];
    seatedStaff(s.office, s.staff, isDesk).forEach(({ member, desk: f }, k) => {
      // 外にいる社員と、歩いている社員は、机の前にいないので選べない
      const c = this.commutes.get(member.uid);
      if (c && c.state !== 'seated') return;
      // 休憩の途中の社員は、机の前にいないので選べない
      const b = this.breaks.get(member.uid);
      if (b && b.phase !== 'desk') return;
      hits.push({ uid: member.uid, ...deskStaffPos(f.x, f.y, ts, deskTap(this.elapsed, k)) });
    });
    const unseated = unseatedStaff(s.office, s.staff, isDesk);
    this.wanderers.forEach((w, k) => {
      const member = unseated[k];
      if (member) hits.push({ uid: member.uid, ...wanderStaffPos(w.x, w.y, ts) });
    });
    return hits;
  }

  // 自社オフィスの家具。スプライトの下端をマスの下端に揃え、1マスより高い分は上へはみ出させる
  private drawFurniture(furniture: PlacedFurniture[], ts: number): void {
    for (const f of furniture) {
      // 家具の絵は定義の sprite を使う（机と椅子・机だけは、同じ机の ID でも絵が違うため）
      const base = furnitureData[f.id as FurnitureId]?.sprite ?? '';
      const tex = texture(spriteOf(FACING_SPRITES.has(base) ? spriteNameOf(base, f.facing ?? 'up') : base));
      if (!tex) continue;
      const sprite = new Sprite(tex);
      sprite.position.set(f.x * ts + Math.round((ts - tex.width) / 2), (f.y + 1) * ts - tex.height);
      // 机の上に置いたPCより後ろに描く。撤去の道具でマウスを乗せた家具は赤みがかった明るさにする
      sprite.zIndex = (f.y + 1) * ts - DEVICE_FOOT_INSET - 1;
      sprite.tint = f.uid === this.hoverFurnUid ? REMOVE_TINT : 0xffffff;
      this.sprites.addChild(sprite);
      // 椅子つきの机は、椅子を机の手前に別の絵で描く（B10）。社員は椅子の上に重なる
      if (CHAIR_FURNITURE.has(f.id)) this.drawChair(f, ts);
    }
  }

  // 机の手前の椅子。マスの下端から少しはみ出す位置に描く（机の天板には載せない）
  private drawChair(f: PlacedFurniture, ts: number): void {
    const tex = texture(spriteOf(spriteNameOf(CHAIR_SPRITE, f.facing ?? 'up')));
    if (!tex) return;
    const sprite = new Sprite(tex);
    sprite.position.set(f.x * ts + Math.round((ts - tex.width) / 2), (f.y + 1) * ts - CHAIR_TOP_INSET);
    sprite.zIndex = (f.y + 1) * ts - DEVICE_FOOT_INSET;
    this.sprites.addChild(sprite);
  }

  // 自社オフィスで、そのマスに机の家具があるか
  private deskAt(x: number, y: number): boolean {
    return (
      this.map?.id === 'hq' &&
      useGameStore.getState().office.furniture.some((f) => f.x === x && f.y === y && isDeskFurniture(f.id, gameEnv))
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
    if (selected) {
      g.rect(x - 2, y - 2, size + 4, size + 4).stroke({ width: 2, color: SELECT, alpha });
    }
    // 機器はスプライト（24×40）で描く。足元（底面の行）をタイルの下寄りに揃え、床に置いた影を添える
    // PC は、机の上にあれば机と同じ向きの絵にする（N95）
    const deviceBase = deviceData[node.device as keyof typeof deviceData]?.sprite ?? '';
    const deskFacing = useGameStore.getState().office.furniture.find((f) => f.x === node.x && f.y === node.y && f.id === 'desk')?.facing ?? 'up';
    const deviceSprite = FACING_DEVICE_SPRITES.has(deviceBase) ? spriteNameOf(deviceBase, deskFacing) : deviceBase;
    const tex = texture(spriteOf(deviceSprite));
    const foot = node.y * ts + ts - DEVICE_FOOT_INSET;
    if (!tex) return;
    const sprite = new Sprite(tex);
    // スプライトの底面の行（y=37）が足元に来る位置。PCは机の天板に載せ、影は付けない
    const deskTile = this.deskAt(node.x, node.y);
    const anyFloor = useGameStore.getState().mode === 'sandbox';
    const onDesk = deskTile || (isPcOnlyDevice(node.device) && !anyFloor);
    // 机のないマスに置いたPCには、机も一緒に描く
    const deskTex = !deskTile && category === CATEGORY.pc && !anyFloor ? texture('furniture/desk') : undefined;
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

    // ポート（下の辺）。使用中は塗りつぶし、空きは白抜き
    const count = gameEnv.devices[node.device]?.portCount ?? 0;
    const used = new Set<number>();
    for (const l of project.links) {
      if (l.a.node === node.uid) used.add(l.a.port);
      if (l.b.node === node.uid) used.add(l.b.port);
    }
    for (let port = 0; port < count; port++) {
      const px = x + ((port + 0.5) * size) / count - 2;
      const py = foot + 1;
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
    const scale = this.content.scale.x;
    // 文字は倍率で割り、画面上で 12 px にする
    const text = new Text({
      text: mark,
      style: { fontFamily: 'sans-serif', fontSize: 12 / scale, fontWeight: 'bold', fill: color, stroke: { color: OUTLINE, width: 3 / scale } },
      resolution: this.textResolution(),
    });
    text.anchor.set(0.5, 1);
    text.position.set(node.x * ts + ts / 2, node.y * ts - 2);
    this.bubbles.addChild(text);
  }

  // 施工中の社員と進捗バー。施工前の機器と配線を順に回る
  private drawBuilding(project: Project, ts: number): void {
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
      this.drawStaff(at.x + (k === 0 ? -18 : 2), at.y - 24 - bob, useGameStore.getState().staff[k]?.look ?? STAFF_PLACEHOLDER_LOOKS[k % STAFF_PLACEHOLDER_LOOKS.length], useGameStore.getState().staff[k]);
    }

    // 施工の進み具合は、ツールバーの帯（Toolbar.tsx）だけに出す。マップの下端には描かない（B13。パソコンも1本にそろえる）
  }

  // 社員のスプライト（16×24 px）。2コマで足踏みする
  // tag があれば、頭の上に名札（名前と職種）を出す。社員の名前が分からないときは出さない
  private drawStaff(x: number, y: number, shirt: string, tag?: { name: string; job: string }): void {
    const frame = Math.floor(this.elapsed / (FRAME_MS * 2)) % 2;
    const tex = texture(spriteOf(`staff/${staffSpriteName(shirt)}_${frame}`));
    if (!tex) return;
    const sprite = new Sprite(tex);
    const left = Math.round(x);
    const top = Math.round(y);
    sprite.position.set(left, top);
    sprite.zIndex = top + STAFF_FOOT;
    this.sprites.addChild(sprite);
    // 足元の影（機器と同じく床に接地していることを示す）
    this.bg.ellipse(left + 8, top + STAFF_FOOT, 6, 2).fill({ color: 0x000000, alpha: 0.25 });
    if (tag) this.drawNameTag(left + STAFF_W / 2, top, tag);
  }

  // 社員の名札（「名前 (職種)」を1行で、頭の上に出す）。IPの表示と同じく、背景は付けず縁取りで読めるようにする
  private drawNameTag(cx: number, headTop: number, tag: { name: string; job: string }): void {
    const scale = this.content.scale.x;
    const fontPx = 11 / scale;
    const text = new Text({
      text: `${tDyn(tag.name)} (${tDyn(`staff.job.${tag.job}`)})`,
      style: { fontFamily: 'monospace', fontSize: fontPx, fill: 0xf4f1e6, align: 'center', stroke: { color: OUTLINE, width: 2 / scale } },
      resolution: Math.max(2, scale * (window.devicePixelRatio || 1)),
    });
    text.anchor.set(0.5, 1);
    text.position.set(cx, headTop - 2 / scale);
    this.bubbles.addChild(text);
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

    const elapsed = this.realElapsed - this.traceStart;
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
  // 失敗の表示を出す機器（uid → 理由）。設計中の案件の検査結果だけ。機器ごとに最初の失敗
  private failureNodes(project: Project): Map<string, FailureReason> {
    const byNode = new Map<string, FailureReason>();
    const s = useGameStore.getState();
    const check = s.check;
    // 案件の設計中、またはサンドボックスの自社オフィス（projectId は hq）の結果を出す
    if (!check || check.projectId !== project.id || project.phase !== 'design' || (!focusedProject(s) && s.mode !== 'sandbox')) return byNode;
    for (const goal of check.goals) {
      for (const f of goal.failures) if (!byNode.has(f.node)) byNode.set(f.node, f.reason);
    }
    return byNode;
  }

  private drawFailures(project: Project, ts: number, byNode: ReadonlyMap<string, FailureReason>): void {
    this.helpRects.clear();
    const s = useGameStore.getState();
    if (byNode.size === 0) return;
    const scale = this.content.scale.x;
    const resolution = this.textResolution();
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
      const message = new Text({ text: tDyn(`error.${reason}`), style: style(0xf4f1e6, false), resolution });
      const help = new Text({ text: t('ui.fail.help'), style: style(SELECT, true), resolution });
      const parts = [mark, message, help];
      const width = parts.reduce((sum, part) => sum + part.width, 0) + gap * (parts.length - 1);
      // 機器の上端に置く（IPアドレスの表示は出さない）
      const bottom = this.spriteTopOf(node, ts) + 4 - gap;
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
        const fix = new Text({ text: tDyn(`error.${reason}.fix`), style: style(0xf4f1e6, false), resolution });
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

  // 文字の解像度（拡大率と画面の密度に合わせ、にじませない）
  private textResolution(): number {
    return Math.max(2, this.content.scale.x * (window.devicePixelRatio || 1));
  }

  // ドット絵の吹き出し（角丸は使わない）。頭（headTop）の上に置き、マップの中に収める。文字は 12 px、最大幅 160 px で折り返す。
  // 枠と尾は画面の 1 px 単位で描き、倍率にかかわらず画面上で同じ大きさにする
  private drawSpeech(message: string, cx: number, headTop: number): void {
    const map = this.mapSize();
    const u = 1 / this.content.scale.x;
    const pad = 4 * u;
    const text = new Text({
      text: message,
      style: { fontFamily: 'sans-serif', fontSize: 12 * u, fill: OUTLINE, align: 'center', wordWrap: true, wordWrapWidth: 160 * u },
      resolution: this.textResolution(),
    });
    const w = text.width + pad * 2;
    const h = text.height + pad * 2;
    // 地（尾の先端は頭の少し上）。マップの外に出るときは内側へずらす
    const left = Math.min(Math.max(cx - w / 2, 0), Math.max(0, map.w - w));
    const top = Math.max(0, headTop - 4 * u - h);
    const tailX = Math.min(Math.max(cx, left + 4 * u), left + w - 4 * u);
    const tailY = top + h + u;
    const box = new Graphics();
    // 外枠は角を1 px欠いた形（角の先を立てない）。中の面も同じく角を欠く
    box.rect(left - u, top, w + 2 * u, h).fill(OUTLINE);
    box.rect(left, top - u, w, h + 2 * u).fill(OUTLINE);
    box.rect(left, top + u, w, h - 2 * u).fill(BUBBLE_FILL);
    box.rect(left + u, top, w - 2 * u, h).fill(BUBBLE_FILL);
    // 尾（下へ細くなる）
    box.rect(tailX - 2 * u, tailY, 4 * u, u).fill(OUTLINE);
    box.rect(tailX - u, tailY + u, 2 * u, u).fill(OUTLINE);
    this.bubbles.addChild(box);
    text.anchor.set(0, 0);
    text.position.set(left + pad, top + pad);
    this.bubbles.addChild(text);
  }

  private flashActive(): boolean {
    const f = useGameStore.getState().flash;
    return f !== null && Date.now() - f.at < FLASH_MS;
  }

  private pulseActive(): boolean {
    const p = useGameStore.getState().linkPulse;
    return p !== null && Date.now() - p.at < PULSE_MS;
  }

  // つながった瞬間: 新しいケーブルの上を、明るい光の粒が端から端へ走る。両端の機器は、一瞬だけ光の輪で囲む
  private drawLinkPulse(project: Project, ts: number): void {
    const p = useGameStore.getState().linkPulse;
    if (!p || !this.pulseActive()) return;
    const link = project.links.find(
      (l) => (l.a.node === p.a && l.b.node === p.b) || (l.a.node === p.b && l.b.node === p.a),
    );
    if (!link || link.path.length < 2) return;
    const pts = link.path.map(([x, y]) => ({ x: x * ts + ts / 2, y: y * ts + ts / 2 }));
    // 折れ線の全長に対して、いまの位置を求める
    const seg: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
      seg.push(seg[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    }
    const total = seg[seg.length - 1];
    const k = Math.min(1, (Date.now() - p.at) / PULSE_MS);
    const target = total * k;
    let i = 1;
    while (i < seg.length - 1 && seg[i] < target) i++;
    const span = seg[i] - seg[i - 1] || 1;
    const r = (target - seg[i - 1]) / span;
    const x = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * r;
    const y = pts[i - 1].y + (pts[i].y - pts[i - 1].y) * r;
    this.g.circle(x, y, ts / 5).fill({ color: 0xffd866, alpha: 0.9 });
    this.g.circle(x, y, ts / 5 + 3).stroke({ width: 2, color: 0xffd866, alpha: 0.5 });
    // 両端の機器の周りに、光の輪が広がって消える
    for (const end of [pts[0], pts[pts.length - 1]]) {
      this.g.circle(end.x, end.y, ts * (0.4 + 0.4 * k)).stroke({ width: 2, color: 0xffd866, alpha: 1 - k });
    }
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
    const scale = this.content.scale.x;
    const text = new Text({
      text: tDyn(f.key),
      style: { fontFamily: 'sans-serif', fontSize: 12 / scale, fill: 0xffd866, stroke: { color: OUTLINE, width: 3 / scale } },
      resolution: this.textResolution(),
    });
    text.anchor.set(0.5, 1);
    // 失敗の瞬間は、地点に赤い輪が広がり、吹き出しが左右に小さく揺れる（すぐ収まる）
    const age = Date.now() - f.at;
    const shake = age < SHAKE_MS ? Math.sin((age / SHAKE_MS) * Math.PI * 4) * 3 * (1 - age / SHAKE_MS) : 0;
    text.position.set(f.tx * ts + ts / 2 + shake, f.ty * ts - 4);
    this.bubbles.addChild(text);
    if (age < SHAKE_MS) {
      const k = age / SHAKE_MS;
      this.g.circle(f.tx * ts + ts / 2, f.ty * ts + ts / 2, ts * (0.35 + 0.3 * k)).stroke({ width: 2, color: FAIL, alpha: 1 - k });
    }
  }

  // マップの座標に変換する（拡大と配置の補正を除いた、タイルの座標系）
  private toMap(e: FederatedPointerEvent): { x: number; y: number } {
    return this.toMapAt(e.global);
  }

  private toMapAt(global: Point): { x: number; y: number } {
    const cam = this.camera;
    if (!cam) return { x: 0, y: 0 };
    return screenToMap(global, cam);
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

  // 機器・家具・社員の説明。社員は、描いている社員のスプライトの範囲で判定する（机のマスでは机の説明）。なければ null
  private mapTipAt(p: { x: number; y: number }): { key: string; text: string } | null {
    const store = useGameStore.getState();
    const staffUid = staffAt(this.officeStaffHits(), p);
    const member = staffUid ? store.staff.find((m) => m.uid === staffUid) : undefined;
    if (member) {
      const lines = [tDyn(member.name), tDyn(`staff.job.${member.job}`), t('ui.staff.level', { level: member.level })];
      return { key: `s:${member.uid}`, text: lines.join('\n') };
    }
    const tile = this.tileOf(p);
    if (!tile) return null;
    const { tx, ty } = tile;
    const node = this.project()?.nodes.find((n) => n.x === tx && n.y === ty);
    if (node) {
      const ips = this.compiled?.net.nodes.find((n) => n.uid === node.uid)?.interfaces.map((i) => `${i.ip}/${i.prefix}`) ?? [];
      return { key: `n:${node.uid}`, text: [nodeLabel(store, node, this.project()?.nodes ?? []), ...ips].join('\n') };
    }
    if (!focusedProject(store) && !store.showcase) {
      const f = store.office.furniture.find((x) => x.x === tx && x.y === ty);
      if (f) {
        const lines = [tDyn(`furniture.${f.id}.name`), effectText(gameEnv.furniture?.[f.id]?.effect)];
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
    const hit = this.mapTipAt(this.toMap(e));
    const key = hit?.key ?? null;
    if (key === this.tipKey) return;
    this.resetTip();
    this.tipKey = key;
    if (!hit) return;
    this.tipTimer = window.setTimeout(() => this.showTip(hit.text, e.clientX, e.clientY), balance.tooltip.hoverMs);
  }

  // タッチ: 押した機器の説明を、長押しのあとに出す
  private startTouchTip(e: FederatedPointerEvent): void {
    const hit = this.mapTipAt(this.toMap(e));
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

  private onCanvasLeave = (): void => this.clearMapHover();

  // ポインタの下が canvas でないとき（DOM のウィンドウなどが覆っているとき）は、マップの説明と乗せた対象を消す
  private onWindowPointerMove = (e: PointerEvent): void => {
    if (document.elementFromPoint(e.clientX, e.clientY) === this.app.canvas) return;
    this.clearMapHover();
  };

  // マップの説明と、マウスを乗せた対象（機器・配線・家具）を消す
  private clearMapHover(): void {
    this.resetTip();
    const hovering = this.hoverLinkUid !== null || this.hoverNodeUid !== null || this.hoverFurnUid !== null || this.hoverAnyNode !== null || this.hoverAnyLink !== null;
    this.hoverLinkUid = null;
    this.hoverNodeUid = null;
    this.hoverFurnUid = null;
    this.hoverAnyNode = null;
    this.hoverAnyLink = null;
    if (hovering) this.drawObjects();
  }

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

  // 機器を押した瞬間の反応（機器の uid と押した時刻）
  private pressFx: { uid: string; at: number } | null = null;

  private pressActive(): boolean {
    return this.pressFx !== null && Date.now() - this.pressFx.at < PRESS_MS;
  }

  // 押した機器の周りに、小さな輪が広がって消える（ボタンを押したのが分かるように）
  private drawPressFx(project: Project, ts: number): void {
    const fx = this.pressFx;
    if (!fx || !this.pressActive()) return;
    const node = project.nodes.find((n) => n.uid === fx.uid);
    if (!node) return;
    const k = (Date.now() - fx.at) / PRESS_MS;
    this.g.circle(node.x * ts + ts / 2, node.y * ts + ts / 2, ts * (0.35 + 0.3 * k)).stroke({ width: 2, color: 0xffd866, alpha: 1 - k });
  }

  private onDown = (e: FederatedPointerEvent): void => {
    // 指が2本のときはピンチが扱う
    if (this.touches.size >= 2) return;
    if (e.pointerType === 'touch') this.startTouchTip(e);
    // 中ボタンのドラッグは、どの道具でも動かす
    if (e.button === 1) {
      this.beginPan(e, true);
      return;
    }
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
    // 背景は、長押しのあとにドラッグで動かす。選択の道具では、そのままドラッグで動かす
    if (e.button === 0 && !store.placing && this.isBackground(p, tile)) this.beginPan(e, store.tool === 'select' || e.pointerType === 'touch');
    if (!tile) return;
    // 選択の道具で社員を押すと、社員の札を開く（機器を編集できない状態でも開ける）
    const staffUid = store.tool === 'select' && e.button !== 2 && !store.placing ? staffAt(this.officeStaffHits(), p) : undefined;
    if (staffUid) {
      store.toggleWindow('staff', staffUid);
      return;
    }
    // 機器を編集できないとき（納品の結果や施工中）は何もしない
    const nodes = this.editNodes();
    if (!nodes) return;
    // 右クリックは、どの道具でも撤去する
    if (e.button === 2) {
      this.removeAt(p, nodes);
      return;
    }
    const node = this.nodeNear(p, nodes);
    // 機器を押した瞬間の反応（短い輪を出す）
    if (node && e.button === 0) this.pressFx = { uid: node.uid, at: Date.now() };
    // ケーブルの端は、離すまで挿し替えか押したかを決めない（配置中は、置く操作を優先する）
    if (e.button === 0 && !store.placing && (store.tool === 'select' || store.tool === 'wire')) {
      const end = cableEndAt(this.editLinks() ?? [], p.x, p.y, this.tileSize(), this.content.scale.x);
      if (end) {
        const wire = store.tool === 'wire';
        this.startPress(e, { kind: 'end', linkUid: end.linkUid, end: end.end }, () => {
          if (wire) this.wireDown(p, node);
        });
        return;
      }
    }
    // 機材を置く予定があり、機器でない場所を押したら置く（続けて置けるよう、配置モードはそのままにする）
    if (store.placing && !node) {
      store.place(store.placing, tile.tx, tile.ty);
      return;
    }
    switch (store.tool) {
      case 'select': {
        // 機器・家具は、離すまで押したか動かしたかを決めない。動かさずに離したら、機器の画面を開く（家具は何もしない）
        // 指で押したときは、長押しのあとに持ち上げる（それまでに大きく動けばマップを移動する）
        const hold = e.pointerType === 'touch';
        if (node) {
          this.startPress(e, { kind: 'node', uid: node.uid }, () => store.toggleWindow('device', node.uid), hold);
          return;
        }
        const furniture = this.furnitureAt(tile);
        if (furniture) this.startPress(e, { kind: 'furniture', uid: furniture.uid }, () => undefined, hold);
        return;
      }
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
    const cam = this.camera;
    if (!cam) return;
    const at = { x: cam.x + (node.x * ts + ts) * cam.zoom, y: cam.y + (node.y * ts + ts / 2) * cam.zoom };
    const rect = this.app.canvas.getBoundingClientRect();
    useGameStore.getState().openPortMenu(node.uid, rect.left + at.x + 6, rect.top + at.y - 12);
  }

  // ---- 機器・家具の移動、ケーブルの端の挿し替え（押してから動かす）----

  // 押したあとの操作を覚える。動かさずに離せば click、動かせばドラッグ
  // hold のとき（指で機器・家具を押したとき）は、TOUCH_HOLD_MS の長押しのあとに動かせるようにする
  private startPress(e: FederatedPointerEvent, target: PressTarget, click: () => void, hold = false): void {
    this.clearPress();
    const at = { x: e.global.x, y: e.global.y };
    const press: Press = { x0: e.clientX, y0: e.clientY, target, click, dragging: false, at: null, g0: at, last: at, hold, timer: null };
    if (hold) {
      press.timer = window.setTimeout(() => {
        press.timer = null;
        if (this.press !== press) return;
        press.dragging = true;
        press.at = this.toMapAt(press.last);
        this.resetTip();
        this.drawObjects();
      }, TOUCH_HOLD_MS);
    }
    this.press = press;
  }

  // 押している操作を消す（長押しの計時も止める）
  private clearPress(): void {
    const press = this.press;
    if (press?.timer != null) window.clearTimeout(press.timer);
    this.press = null;
  }

  // 押した位置から一定以上動いたら、ドラッグを始める。動いている間は、マップの座標の位置を覚えて描き直す。押している間は true
  // 指で長押しの前に TOUCH_PAN_PX 以上動いたときは、機器をつかまず、背景のドラッグ（マップの移動）に切り替える
  private pressMove(e: FederatedPointerEvent): boolean {
    const press = this.press;
    if (!press) return false;
    press.last = { x: e.global.x, y: e.global.y };
    if (!press.dragging) {
      if (press.hold) {
        if (Math.hypot(e.clientX - press.x0, e.clientY - press.y0) < TOUCH_PAN_PX) return true;
        this.clearPress();
        this.beginPanAt(press.g0, true);
        this.movePan(e);
        return true;
      }
      if (!isDragMove(press.x0, press.y0, e.clientX, e.clientY)) return true;
      press.dragging = true;
      this.resetTip();
    }
    press.at = this.toMapAt(press.last);
    this.drawObjects();
    return true;
  }

  // 離したとき。動かさずに離したら押した扱い、動かしていたら離した位置で動かす・挿し替える（置けなければ何もしない）
  private finishPress(): void {
    const press = this.press;
    this.clearPress();
    if (!press) return;
    if (!press.dragging) press.click();
    else if (press.at) this.dropPress(press.target, press.at);
    this.drawObjects();
  }

  // ドラッグの途中の Esc は、ドラッグだけを取り消す（ほかの Esc の処理には渡さない）
  private onPressKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !this.press?.dragging) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.clearPress();
    this.drawObjects();
  };

  // 離した位置で、機器・家具を移す、またはケーブルの端を別の機器へ挿す。判定は sim の純粋関数と同じ
  private dropPress(target: PressTarget, at: Point): void {
    const store = useGameStore.getState();
    if (target.kind === 'end') {
      const node = this.nodeNear(at, this.editNodes() ?? []);
      if (node && this.canReplug(target.linkUid, target.end, node.uid)) store.replugTo(target.linkUid, target.end, node.uid, null);
      return;
    }
    const tile = this.tileOf(at);
    if (!tile) return;
    if (target.kind === 'node') {
      const node = this.editNodes()?.find((n) => n.uid === target.uid);
      if (!node || (node.x === tile.tx && node.y === tile.ty)) return;
      if (this.canMoveNode(target.uid, tile.tx, tile.ty)) store.moveNode(target.uid, tile.tx, tile.ty);
      return;
    }
    const furniture = store.office.furniture.find((f) => f.uid === target.uid);
    if (!furniture || (furniture.x === tile.tx && furniture.y === tile.ty)) return;
    if (this.canMoveFurniture(target.uid, tile.tx, tile.ty)) store.moveFurniture(target.uid, tile.tx, tile.ty);
  }

  // 機器・家具・配線の端の判定（store の操作と同じ条件で、sim の純粋関数を試す）
  private canMoveNode(uid: string, tx: number, ty: number): boolean {
    const s = useGameStore.getState();
    return this.map !== null && moveNode(coreOf(s), uid, tx, ty, gameEnv, netTargetOf(s), this.map).ok;
  }

  private canMoveFurniture(uid: string, tx: number, ty: number): boolean {
    const s = useGameStore.getState();
    return s.maps.hq !== undefined && moveFurniture(coreOf(s), uid, tx, ty, s.maps.hq).ok;
  }

  private canReplug(linkUid: string, end: End, nodeUid: string): boolean {
    const s = useGameStore.getState();
    return replugTo(coreOf(s), linkUid, end, nodeUid, null, gameEnv, netTargetOf(s)).ok;
  }

  // 品目（機材・家具）を、マスに置けるか（インベントリの欄からのドラッグと、配置の表示で使う）
  private canPlace(id: string, tx: number, ty: number): boolean {
    const s = useGameStore.getState();
    const core = coreOf(s);
    const hq = s.maps.hq;
    if (!hq) return false;
    if (id in furnitureData) return placeFurniture(core, id, tx, ty, hq).ok;
    if (s.active.length === 0) return placeInOffice(core, id, tx, ty, hq, gameEnv, s.mode === 'sandbox').ok;
    return this.map !== null && placeDevice(core, id, tx, ty, this.map, gameEnv).ok;
  }

  // 画面の座標（クライアントの座標）のマス。マップの外なら null
  private tileAtClient(clientX: number, clientY: number): { tx: number; ty: number } | null {
    const cam = this.camera;
    if (!cam) return null;
    const rect = this.app.canvas.getBoundingClientRect();
    return this.tileOf(screenToMap({ x: clientX - rect.left, y: clientY - rect.top }, cam));
  }

  // 編集できるケーブル（自社オフィス、または設計中の案件）
  private editLinks(): readonly NetLink[] | null {
    return editNetOf(useGameStore.getState())?.links ?? null;
  }

  // 自社オフィスで動かせる家具（押した位置のマス）。案件の受注中や納品の結果の表示では動かせない
  private furnitureAt(tile: { tx: number; ty: number }): PlacedFurniture | undefined {
    const s = useGameStore.getState();
    if (this.map?.id !== 'hq' || s.active.length > 0 || s.showcase) return undefined;
    return s.office.furniture.find((f) => f.x === tile.tx && f.y === tile.ty);
  }

  // マスの枠。置ける（明るく・緑の枠）か、置けない（暗く・赤の枠）かを示す
  private drawTileState(tx: number, ty: number, ts: number, ok: boolean): void {
    const x = tx * ts;
    const y = ty * ts;
    this.g.rect(x, y, ts, ts).fill({ color: ok ? 0xffffff : 0x000000, alpha: ok ? 0.3 : 0.45 });
    this.g.rect(x + 1, y + 1, ts - 2, ts - 2).stroke({ width: 2, color: ok ? 0x62d26f : FAIL });
  }

  // インベントリの欄からドラッグ中、または配置中は、カーソルのマスを置けるかで示す
  private drawPlacePreview(ts: number): void {
    const s = useGameStore.getState();
    const id = s.itemDrag?.id ?? s.placing;
    if (!id) return;
    const tile = s.itemDrag ? this.tileAtClient(s.itemDrag.x, s.itemDrag.y) : this.cursorTile;
    if (!tile) return;
    this.drawTileState(tile.tx, tile.ty, ts, this.canPlace(id, tile.tx, tile.ty));
  }

  // ドラッグ中の表示。機器・家具は移す先のマスを示し、ケーブルの端は挿し替える先の機器を示して、仮の線を引く
  private drawDrag(ts: number): void {
    const press = this.press;
    if (!press?.dragging || !press.at) return;
    const at = press.at;
    const target = press.target;
    if (target.kind === 'node' || target.kind === 'furniture') {
      const tile = this.tileOf(at);
      if (!tile) return;
      const ok = target.kind === 'node' ? this.canMoveNode(target.uid, tile.tx, tile.ty) : this.canMoveFurniture(target.uid, tile.tx, tile.ty);
      this.drawTileState(tile.tx, tile.ty, ts, ok);
      return;
    }
    const link = this.editLinks()?.find((l) => l.uid === target.linkUid);
    if (!link) return;
    const other = this.editNodes()?.find((n) => n.uid === (target.end === 'a' ? link.b.node : link.a.node));
    const node = this.nodeNear(at, this.editNodes() ?? []);
    const ok = node !== undefined && this.canReplug(target.linkUid, target.end, node.uid);
    if (node) this.drawTileState(node.x, node.y, ts, ok);
    if (other) {
      this.g.moveTo(other.x * ts + ts / 2, other.y * ts + ts / 2);
      this.g.lineTo(at.x, at.y);
      this.g.stroke({ width: 2, color: ok ? SELECT : FAIL });
    }
  }

  // マウスを乗せたケーブルの両端に、つかめる差し込み口の印を出す（選択と配線の道具で、押していないとき）
  private drawPlugMarks(ts: number): void {
    const s = useGameStore.getState();
    if (this.press || s.placing || (s.tool !== 'select' && s.tool !== 'wire')) return;
    const link = this.editLinks()?.find((l) => l.uid === this.hoverAnyLink);
    if (!link) return;
    const size = 6 / this.content.scale.x;
    const plugs = plugPoints(link, ts);
    for (const plug of [plugs.a, plugs.b]) {
      this.g.rect(plug.x - size / 2, plug.y - size / 2, size, size).fill({ color: SELECT });
      this.g.rect(plug.x - size / 2, plug.y - size / 2, size, size).stroke({ width: 1 / this.content.scale.x, color: OUTLINE });
    }
  }

  private onMove = (e: FederatedPointerEvent): void => {
    if (this.touches.size >= 2) return;
    if (this.movePan(e)) return;
    if (this.pressMove(e)) return;
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
    const reason = checkConnect(coreOf(store), start.uid, target.uid, store.wireCable, gameEnv, netTargetOf(store), ports);
    this.hover = { uid: target.uid, reason };
  }

  // マウスを乗せた配線・機器・家具を覚え、変わったときだけ描き直す（配置中は強調しない）。
  // 撤去の道具では、押すと消える機器・家具・配線を赤みがかった明るさで示す
  private updateHover(e: FederatedPointerEvent): void {
    const store = useGameStore.getState();
    const p = this.toMap(e);
    const tile = this.tileOf(p);
    // ポートの名前を出すための、任意の道具でマウスを乗せた機器と配線
    const project = this.project();
    const anyNode = project ? this.nodeNear(p, project.nodes)?.uid ?? null : null;
    const anyLink = project ? linkAt(project.links, p.x, p.y, this.tileSize(), this.content.scale.x)?.uid ?? null : null;
    const anyChanged = anyNode !== this.hoverAnyNode || anyLink !== this.hoverAnyLink;
    this.hoverAnyNode = anyNode;
    this.hoverAnyLink = anyLink;
    const removing = store.tool === 'remove' && !store.placing;
    const nodes = removing ? this.editNodes() : null;
    const node = nodes ? this.nodeNear(p, nodes) : undefined;
    const inOffice = store.active.length === 0 && !store.showcase;
    const furniture =
      removing && inOffice && tile ? store.office.furniture.find((f) => f.x === tile.tx && f.y === tile.ty) : undefined;
    const link = store.placing ? undefined : this.linkUnder(p);
    const next = { node: node?.uid ?? null, furniture: furniture?.uid ?? null, link: link?.uid ?? null };
    if (next.node === this.hoverNodeUid && next.furniture === this.hoverFurnUid && next.link === this.hoverLinkUid) {
      if (anyChanged) this.drawObjects();
      return;
    }
    this.hoverNodeUid = next.node;
    this.hoverFurnUid = next.furniture;
    this.hoverLinkUid = next.link;
    this.drawObjects();
  }

  private onUp = (e: FederatedPointerEvent): void => {
    if (e.pointerType === 'touch') this.endTouchTip();
    this.endPan();
    if (this.press) {
      this.finishPress();
      return;
    }
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
    this.endPan();
    this.clearPress();
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
    // 長さはメートルで出す。上限を超えたら赤くし、配線できないことを示す（N49）
    const meters = metersOf(length, balance.metersPerTile);
    const limit = metersOf(cable.maxLengthTiles, balance.metersPerTile);
    const over = length > cable.maxLengthTiles;
    const text = new Text({
      text: t('ui.wire.cost', { length: meters, limit, cost: cost.toLocaleString('ja-JP') }),
      style: { fontFamily: 'sans-serif', fontSize: 12 / scale, fill: over ? 0xff8a7a : 0xf4f1e6, stroke: { color: OUTLINE, width: 2 / scale } },
      resolution: Math.max(2, scale * (window.devicePixelRatio || 1)),
    });
    text.anchor.set(0, 1);
    text.position.set(this.wireTo.x + ts * 0.25, this.wireTo.y - ts * 0.25);
    this.bubbles.addChild(text);
  }

  // ケーブルの両端に、つないだポートの名前を出す（IPの表示と同じく showIp のときだけ）。
  // 配線の道具を選んでいるとき、またはケーブルか機器にマウスを乗せたときだけ出す
  private drawPortNames(project: Project, ts: number): void {
    const s = useGameStore.getState();
    const nodes = new Map(project.nodes.map((n) => [n.uid, n] as const));
    for (const link of project.links) {
      const relevant = s.tool === 'wire' || link.uid === this.hoverAnyLink || link.a.node === this.hoverAnyNode || link.b.node === this.hoverAnyNode;
      if (!relevant) continue;
      // マス単位の折れ線を、画面の中心（マップの座標）に直す。a の機器から始まる
      const pts: Point[] = link.path.map(([x, y]) => ({ x: x * ts + ts / 2, y: y * ts + ts / 2 }));
      this.portName(nodes.get(link.a.node), link.a.port, pts, ts);
      this.portName(nodes.get(link.b.node), link.b.port, [...pts].reverse(), ts);
    }
  }

  // ポートの名前を1つ描く。pts は、機器の中心（先頭）から始まる折れ線（マップの座標）。
  // ポートが1つの機器には出さない。線の上で、機器から1マス先に置く
  private portName(node: NetNode | undefined, port: number, pts: readonly Point[], ts: number): void {
    if (!node || pts.length < 2) return;
    if ((gameEnv.devices[node.device]?.portCount ?? 0) <= 1) return;
    const at = pointAt(pts, cumulativeLengths(pts), ts);
    const scale = this.content.scale.x;
    const text = new Text({
      text: portLabel(gameEnv.devices[node.device]?.category, port),
      style: { fontFamily: 'sans-serif', fontSize: 11 / scale, fill: 0xf4f1e6, stroke: { color: OUTLINE, width: 2 / scale } },
      resolution: this.textResolution(),
    });
    text.anchor.set(0.5, 0.5);
    text.position.set(at.x, at.y);
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

// 2点の距離（ピンチ）と中点（canvas の座標）
const distOf = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
const midOf = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// 配線の中点（社員が作業する位置）
const midpoint = (link: NetLink, ts: number): Point => {
  const a = link.path[0];
  const b = link.path[link.path.length - 1];
  return { x: ((a[0] + b[0]) / 2) * ts + ts / 2, y: ((a[1] + b[1]) / 2) * ts + ts / 2 };
};
