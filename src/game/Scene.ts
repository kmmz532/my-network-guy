// キャンバスの描画と操作。マップ・機器・配線・社員・パケットを描き、クリックで配置・選択、ドラッグで配線する。
// 描画の状態は store から読むだけで、変更は store の操作を通して行う。
import { Application, Container, Graphics, Text, type Ticker } from 'pixi.js';
import { type GameMap } from '../data/schema';
import { focusedProject, viewingOffice, frontDeviceUid, useGameStore, type Trace } from '../stores/useGameStore';
import { centerPath, plugPoints } from './linkHit';
import { rangeTiles } from './effectRange';
import { setMapView } from './mapView';
import { gameEnv, isPcDevice } from '../sim/env';
import { engineWithWalls } from '../sim/walls';
import { WALL_LOSS, WIRELESS_RADIUS, wallsBetween, wirelessAssociations, withWireless } from '../network/engine';
import type { EngineData } from '../network/types';
import { type Facing } from '../sim/facing';
import { dayTintOf, nightnessOf, toHex, type Rgb } from '../sim/dayTint';
import { loadSettings } from '../settings/settings';

// 向きの絵がある家具（机・椅子）。向きに合わせて絵を切り替える（N95）
// PC のうち、机の上にしか置けないもの（deskable でない PC。N91）
const isPcOnlyDevice = (device: string): boolean => isPcDevice(device) && gameEnv.devices[device]?.deskable !== true;
import { furnitureOf } from '../contracts/layout';
import { expandActionOf, expansionLocked, officeExpandCostOf, type ExpandSide } from '../sim/office';
import { levelOf } from '../sim/level';
import { compiledNet, isDeskFurniture, type Project } from '../sim/project';
import { colorOfLink, networkColors, type NetworkColors } from '../network/netColor';
import type { Compiled, IssueDetail } from '../network/compile';
import { balance } from 'virtual:game-data';
import { t, tDyn } from '../i18n/t';
import type { FailureReason, NetLink, NetNode } from '../network/types';
import { CAP as WALL_CAP, drawTileMap } from './TileMap';
import { bindMapCommands } from './mapControl';
import { addKeyLayer, captureKeys } from '../input/keyRouter';
import { MapCamera } from './MapCamera';
import { MapHit } from './MapHit';
import { MapInput, PRESS_MS } from './MapInput';
import { MapTip } from './MapTip';
import { OfficeStaffMotion, isDesk } from './OfficeStaffMotion';
import { seatedStaff } from '../sim/furniture';
import { cumulativeLengths, pointAt, type Point } from './animation';
import { minutesPerDay as dayMinutes } from '../sim/clock';
import { metersOf } from '../sim/cableLength';
import { type StaffHit } from './staffHit';
import { StaffRenderer } from './StaffRenderer';
import { STAFF_FRAME_MS } from './staffHit';
import { DeviceRenderer } from './DeviceRenderer';
import { CATEGORY } from '../data/categories';
import { FurnitureRenderer } from './FurnitureRenderer';
import { DeviceLabelRenderer } from './DeviceLabelRenderer';


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
// サンドボックスを開いたとき（全体表示より大きい倍率）
// 椅子つきの机の ID と、椅子の絵・マスの下端からの位置（B10）
// 施工中の社員の立つ位置（作業場所からのずれ。マス単位。左・右・下・上の順。N108）
// 時刻による色の重ね（N75）の大きさ（地図の外まで覆う。マス・画素の単位）
const OVERLAY_EXTENT = 20000;
const BUILD_SLOTS: [number, number][] = [[-0.56, 0], [0.06, 0], [-0.25, 0.5], [-0.25, -0.5]];
// 向きごとの椅子の位置のずれ（マス単位）。社員の背中側に椅子を置く（N95）
// 失敗の吹き出しを出しておく時間（ms）
const FLASH_MS = 2500;
// つながった瞬間に、ケーブルの上を光が走る時間（ms）
const PULSE_MS = 450;
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
// 撤去の道具で、マウスを乗せた対象を赤みがかった明るさにする
const HOT_RED = 0xff6b6b;
// 吹き出しの地（クリーム色）
const BUBBLE_FILL = 0xf4f1e6;
// 部屋を広げるボタン（「+」）の大きさは1マスの半分、文字は同じマスの0.75倍。通常は半透明で、マウスを乗せたときだけはっきり出す
const EXPAND_BUTTON_RATIO = 0.5;
const EXPAND_LABEL_RATIO = 0.75;
const EXPAND_IDLE_ALPHA = 0.45;
const EXPAND_SIDES: readonly ExpandSide[] = ['right', 'bottom', 'left'];


export class Scene {
  private content = new Container();
  private tiles: Container | null = null;
  private tilesId: string | null = null;
  private map: GameMap | null = null;
  // 画面の計算に使う環境の機器（無線の範囲と点線）
  private wireEngine: EngineData | null = null;
  // 配線（機器の下）、機器と社員のスプライト、ポート・色・パケットなどの重ね描き（機器の上）
  private bg = new Graphics();
  private sprites = new Container();
  private g = new Graphics();
  // 時刻による色の重ね（乗算）と、夜の明かり（加算）（N75）
  private dayOverlay = new Graphics();
  private nightLights = new Graphics();
  private tintKey = '';
  private bubbles = new Container();
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
  // 失敗の「？」の押せる範囲（機器の uid → マップの座標の矩形）。描き直すたびに作る
  private helpRects = new Map<string, { x: number; y: number; w: number; h: number }>();
  private unsubscribe: () => void;
  // 自社オフィスの部屋を広げるボタン（右・下・左の辺の外側）。描き直さず、位置と表示だけを更新する
  private expandButtons = new Map<ExpandSide, Container>();
  // マップの見え方（位置と倍率）と、それを動かす入力
  private cam: MapCamera;
  private hit: MapHit;
  private tip: MapTip;
  private input: MapInput;
  // ドラッグ中の Esc を横取りする登録の解除
  private releaseKeys: () => void;
  private releaseRotateKey: () => void;
  // 自社オフィスの社員の動き（出勤・休憩・歩き回り）
  private staffMotion = new OfficeStaffMotion();
  // 置き物・社員・機器・機器ラベルは、それぞれの renderer に描画を委ねる
  private furnitureRenderer: FurnitureRenderer;
  private staffRenderer: StaffRenderer;
  private deviceRenderer: DeviceRenderer;
  private deviceLabelRenderer: DeviceLabelRenderer;

  constructor(private app: Application) {
    const base = { app, content: this.content, map: () => this.map, tileSize: () => this.tileSize() };
    this.cam = new MapCamera({ ...base, redraw: () => this.drawObjects(), cancelOperations: () => this.input.cancelOperations() });
    this.hit = new MapHit({ ...base, cam: this.cam });
    this.tip = new MapTip({ hit: this.hit, project: () => this.project(), compiled: () => this.compiled, staffHits: () => this.officeStaffHits() });
    this.input = new MapInput({
      ...base,
      cam: this.cam,
      hit: this.hit,
      tip: this.tip,
      project: () => this.project(),
      staffHits: () => this.officeStaffHits(),
      helpAt: (p) => this.helpAt(p),
      redraw: () => this.drawObjects(),
    });
    this.furnitureRenderer = new FurnitureRenderer({
      sprites: this.sprites,
      hoverFurnitureUid: () => this.input.hoverFurnUid,
    });
    this.staffRenderer = new StaffRenderer({
      sprites: this.sprites,
      background: this.bg,
      bubbles: this.bubbles,
      elapsed: () => this.elapsed,
      scale: () => this.content.scale.x,
      staffMotion: this.staffMotion,
      drawSpeech: (message, cx, headTop) => this.drawSpeech(message, cx, headTop),
    });
    this.deviceRenderer = new DeviceRenderer({
      background: this.bg,
      foreground: this.g,
      sprites: this.sprites,
      elapsed: () => this.elapsed,
      deskAt: (x, y) => this.deskAt(x, y),
      deskFacingAt: (x, y) => this.deskFacingAt(x, y),
    });
    this.deviceLabelRenderer = new DeviceLabelRenderer({
      bubbles: this.bubbles,
      scale: () => this.content.scale.x,
      textResolution: () => this.textResolution(),
      compiled: () => this.compiled,
      spriteTopOf: (node, ts) => this.spriteTopOf(node, ts),
      tool: () => useGameStore.getState().tool,
      hoverLink: () => this.input.hoverAnyLink,
      hoverNode: () => this.input.hoverAnyNode,
    });
    // インベントリの欄（DOM）から、マスの判定と品目を置けるかを使えるようにする
    setMapView({ tileAtClient: (x, y) => this.hit.tileAtClient(x, y), canPlace: (id, tx, ty) => this.input.canPlace(id, tx, ty) });
    this.releaseKeys = captureKeys(this.input.onPressKey);
    window.addEventListener('pointermove', this.input.onWindowPointerMove);
    app.stage.addChild(this.content);
    this.content.addChild(this.bg);
    // 機器と社員は、足元のY座標（zIndex）の昇順に重ねる
    this.sprites.sortableChildren = true;
    this.content.addChild(this.sprites);
    // 時刻による色（N75）は、機器と社員の上・配線と吹き出しの下に重ねる（配線とラベルは暗くしない）
    this.dayOverlay.blendMode = 'multiply';
    this.nightLights.blendMode = 'add';
    this.content.addChild(this.dayOverlay);
    this.content.addChild(this.nightLights);
    this.content.addChild(this.g);
    this.content.addChild(this.bubbles);
    for (const side of EXPAND_SIDES) this.expandButtons.set(side, this.makeExpandButton(side));
    app.stage.eventMode = 'static';
    app.stage.on('pointerdown', this.input.onDown);
    app.stage.on('pointermove', this.input.onMove);
    app.stage.on('pointerup', this.input.onUp);
    app.stage.on('pointerupoutside', this.input.dropWire);
    // R キーで、マウスを乗せた家具（自社オフィスの机など）を90度回す（N95）
    this.releaseRotateKey = addKeyLayer(this.onRotateKey);
    app.canvas.addEventListener('pointerleave', this.input.onCanvasLeave);
    app.canvas.addEventListener('contextmenu', this.preventMenu);
    // ホイールはブラウザの拡大・スクロールを止めるため passive を外す（Ctrl＋ホイールとピンチも、マップの拡大にする）
    app.canvas.addEventListener('wheel', this.cam.onWheel, { passive: false });
    app.canvas.addEventListener('mousedown', this.preventMiddleScroll);
    // 指の操作は、Pixi の操作より先に受け取る（捕捉の段階）。2本目の指で、配線などの操作を取り消す
    app.canvas.addEventListener('pointerdown', this.cam.onPointerDown, true);
    app.canvas.addEventListener('pointermove', this.cam.onPointerMove, true);
    app.canvas.addEventListener('pointerup', this.cam.onPointerUp, true);
    app.canvas.addEventListener('pointercancel', this.cam.onPointerUp, true);
    app.canvas.style.touchAction = 'none';
    app.ticker.add(this.onTick);
    this.unsubscribe = useGameStore.subscribe(() => this.refresh());
    bindMapCommands({
      zoomIn: () => this.cam.zoomBy(1),
      zoomOut: () => this.cam.zoomBy(-1),
      fit: () => this.cam.fit(),
      pan: (dx, dy) => this.cam.panBy(dx, dy),
    });
    this.refresh();
  }

  // R キーで、マウスを乗せた家具を回す（自社オフィスのみ）
  private onRotateKey = (e: KeyboardEvent): boolean => {
    if ((e.key !== 'r' && e.key !== 'R') || e.ctrlKey || e.metaKey || e.altKey) return false;
    if (this.input.hoverFurnUid === null || this.map?.id !== 'hq') return false;
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return false;
    useGameStore.getState().rotateFurniture(this.input.hoverFurnUid);
    return true;
  };

  destroy(): void {
    this.releaseRotateKey();
    this.unsubscribe();
    setMapView(null);
    this.releaseKeys();
    window.removeEventListener('pointermove', this.input.onWindowPointerMove);
    bindMapCommands(null);
    this.cam.endPan();
    this.input.clearPress();
    this.app.ticker.remove(this.onTick);
    this.app.canvas.removeEventListener('wheel', this.cam.onWheel);
    this.app.canvas.removeEventListener('mousedown', this.preventMiddleScroll);
    this.app.canvas.removeEventListener('pointerdown', this.cam.onPointerDown, true);
    this.app.canvas.removeEventListener('pointermove', this.cam.onPointerMove, true);
    this.app.canvas.removeEventListener('pointerup', this.cam.onPointerUp, true);
    this.app.canvas.removeEventListener('pointercancel', this.cam.onPointerUp, true);
    this.app.stage.off('pointerdown', this.input.onDown);
    this.app.stage.off('pointermove', this.input.onMove);
    this.app.stage.off('pointerup', this.input.onUp);
    this.app.stage.off('pointerupoutside', this.input.dropWire);
    this.app.canvas.removeEventListener('pointerleave', this.input.onCanvasLeave);
    this.tip.reset();
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
      inheritedLinks: [],
      // 自社オフィスのセグメントの設定も渡す（ケーブルの色とネットワークの判定に使う）
      segments: office.segments,
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
    const mapId = shown?.contract.map ?? 'office_small';
    const map = s.maps[mapId];
    // 電波の減衰に、地図の壁を使う（N151）
    const env = { ...gameEnv, engine: engineWithWalls(gameEnv.engine, map) };
    this.compiled = shown ? compiledNet(shown, env) : null;
    this.wireEngine = env.engine;
    // 無線の端末は、つながったアクセスポイントの LAN の色で塗る（ケーブルがないので、仮想の配線を足して数える）
    this.netColors = this.compiled ? networkColors(withWireless(this.compiled.net, env.engine), env.engine) : null;
    if (!map) return;
    // 自社オフィスの部屋は広げると作り直すため、同じIDでもマップが変わったら描き直す
    if (this.tilesId !== mapId || this.map !== map) {
      if (this.tiles) this.tiles.destroy({ children: true });
      this.tiles = drawTileMap(map);
      this.content.addChildAt(this.tiles, 0);
      this.tilesId = mapId;
      this.map = map;
      // マップが変わったら全体に合わせる
      this.cam.reset();
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
      this.tip.reset();
      useGameStore.getState().expandOffice(side);
    });
    box.on('pointerover', (e) => {
      box.alpha = 1;
      this.tip.reset();
      const office = useGameStore.getState().office;
      const action = expandActionOf(office, side, balance.office);
      const name = tDyn(`ui.office.${action === 'annex' ? 'annex' : 'expand'}.${side}`);
      const cost = t('ui.office.cost', { cost: officeExpandCostOf(office, balance.office).toLocaleString('ja-JP') });
      this.tip.showAfterHover(`${name}\n${cost}`, e.clientX, e.clientY);
    });
    box.on('pointerout', () => {
      box.alpha = EXPAND_IDLE_ALPHA;
      this.tip.reset();
    });
    // 乗っている間も、マップの移動や配線の操作は続ける。ボタン上の移動では、説明を消さないよう伝えない
    box.on('pointermove', (e) => {
      if (!this.input.wireFrom && !this.cam.panning && !this.input.press) e.stopPropagation();
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
    const shown = viewingOffice(s) && map?.id === 'hq';
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

  // 時刻による色（N75）。色が変わったときだけ重ねを描き直す。夜は、夜勤の机と機器の周りに明かりを描く
  private updateDayTint(): void {
    const map = this.map;
    const s = useGameStore.getState();
    // 設定で切っているときは、色を変えない（白）
    const tint: Rgb = loadSettings().dayTint ? dayTintOf(s.clock.minute % dayMinutes) : { r: 1, g: 1, b: 1 };
    // 背景（マップの外の青）も、同じ時刻の色にする。色は今の背景の色（#2f4f8f）に掛ける
    const bg = { r: 0x2f * tint.r, g: 0x4f * tint.g, b: 0x8f * tint.b };
    const bgHex = toHex({ r: bg.r / 255, g: bg.g / 255, b: bg.b / 255 });
    this.app.renderer.background.color = bgHex;
    if (!map) {
      this.dayOverlay.clear();
      this.nightLights.clear();
      this.tintKey = '';
      return;
    }
    const ts = this.tileSize();
    // 重ねは画面の全体を覆う（地図の外の床・背景も同じ色にする）
    const key = `${toHex(tint)}|${map.id}|${ts}`;
    if (key !== this.tintKey) {
      this.tintKey = key;
      this.dayOverlay.clear().rect(-OVERLAY_EXTENT, -OVERLAY_EXTENT, 2 * OVERLAY_EXTENT, 2 * OVERLAY_EXTENT).fill(toHex(tint));
    }
    this.nightLights.clear();
    const night = nightnessOf(tint);
    if (night > 0.2 && map.id === 'hq') {
      for (const { member, desk } of seatedStaff(s.office, s.staff, isDesk)) {
        if (member.shift !== 'night') continue;
        this.nightLights.circle((desk.x + 0.5) * ts, (desk.y + 0.5) * ts, ts * 0.9).fill({ color: 0xffe9a8, alpha: 0.3 * night });
      }
      for (const n of s.office.nodes) {
        this.nightLights.circle((n.x + 0.5) * ts, (n.y + 0.5) * ts, ts * 0.3).fill({ color: 0x9ff0b0, alpha: 0.35 * night });
      }
    }
  }

  private onTick = (ticker: Ticker): void => {
    // 疎通テストの流れ（粒）は実時間で進める。時間を止めていても（設計中など）流れが動く
    this.realElapsed += ticker.deltaMS;
    // ゲームの速度（一時停止は 0）に合わせて、社員の移動・アニメーション・つぶやきの時間を進める
    const dt = ticker.deltaMS * useGameStore.getState().speed;
    this.elapsed += dt;
    // 画面の大きさが変わったら、マップの位置と倍率を合わせ直す（resize の順に関係なく、描画の時点で拾う）
    this.cam.syncSize();
    this.staffMotion.update(this.map, dt);
    this.updateDayTint();
    // パケットは滑らかに動かす。それ以外はコマ送り（ART.md）
    if (this.traceActive() || this.flashActive() || this.pulseActive() || this.input.pressActive()) {
      this.drawObjects();
      return;
    }
    const frame = Math.floor(this.elapsed / STAFF_FRAME_MS);
    if (frame === this.frame) return;
    this.frame = frame;
    // 社員はいつもコマ送りで動かす
    this.drawObjects();
  };

  private preventMiddleScroll = (e: MouseEvent): void => {
    if (e.button === 1) e.preventDefault();
  };

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
      const hot = link.uid === this.input.hoverLinkUid;
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
    const wireUid = this.input.wireFrom ?? s.wireStart?.uid ?? null;
    const wireNode = wireUid ? project.nodes.find((n) => n.uid === wireUid) : undefined;
    if (wireNode) {
      this.g.moveTo(wireNode.x * ts + ts / 2, wireNode.y * ts + ts / 2);
      this.g.lineTo(this.input.wireTo.x, this.input.wireTo.y);
      this.g.stroke({ width: 2, color: SELECT });
      this.drawWireCost(wireNode, ts);
    }

    // ケーブルの端を挿し替えるドラッグ中（N107）: つかんだケーブルを強調し、もう一方の端から離した位置まで仮の線を引く
    const press = this.input.press;
    if (press?.dragging && press.target.kind === 'end' && press.at) {
      const target = press.target;
      const link = (this.hit.editLinks() ?? []).find((l) => l.uid === target.linkUid);
      if (link) {
        const pts = centerPath(link.path, ts);
        this.g.moveTo(pts[0][0], pts[0][1]);
        for (const [x, y] of pts.slice(1)) this.g.lineTo(x, y);
        this.g.stroke({ width: 4, color: 0xffd866, alpha: 0.9 });
        const plugs = plugPoints(link, ts);
        const fixed = target.end === 'a' ? plugs.b : plugs.a;
        this.g.moveTo(fixed.x, fixed.y);
        this.g.lineTo(press.at.x, press.at.y);
        this.g.stroke({ width: 2, color: 0xffd866, alpha: 0.7 });
      }
    }

    // 疎通テスト中の機器は LED を速く点滅させる
    const onPath = new Set(this.traceActive() ? this.traces.flatMap((tr) => tr.result.path) : []);
    const fastBlink = Math.floor(this.elapsed / 120) % 2 === 0;
    const slowBlink = Math.floor(this.elapsed / 600) % 2 === 0;

    // 自社オフィスの家具は、機材と同じ層で足元のY座標の順に重ねる
    if (map.id === 'hq') this.furnitureRenderer.draw(s.office.furniture, ts);
    // 依頼先の家具（机・棚・飾り。N76）は、地図の固定の家具と合わせて描く
    else this.furnitureRenderer.draw(furnitureOf(map.furniture, project.contract.furniture), ts);

    for (const node of project.nodes) {
      const dim = building && !isBuilt(node.uid, 'nodes');
      // 配線の起点に選んだ機器は、光る枠で選ばれた状態にする
      this.deviceRenderer.drawNode(node, ts, frontDeviceUid(s) === node.uid || s.wireStart?.uid === node.uid, dim, project, this.input.hoverNodeUid === node.uid);
      const blinkOn = onPath.has(node.uid) ? fastBlink : slowBlink;
      const issue = this.issueOf(node, project);
      this.deviceRenderer.drawLed(node, ts, blinkOn, issue?.reason === 'ip.unset');
      // IPアドレスのない機器の表示は drawAddresses で出す。そのほかの不備には「？」を出す
      if (issue && issue.reason !== 'ip.unset') this.deviceLabelRenderer.drawBubble(node, ts, '?', WARN);
    }

    // 失敗の表示があるときは、その機器のIPの表示を出さない（重なるため）
    const failing = this.failureNodes(project);
    if (s.showIp) {
      this.deviceLabelRenderer.drawAddresses(ts, failing);
      this.deviceLabelRenderer.drawPortNames(project, ts);
    }
    if (building) this.drawBuilding(project, ts);
    else if (this.map?.id === 'hq' && !s.showcase) {
      this.staffRenderer.drawDeskStaff(ts);
      this.staffRenderer.drawWanderers(ts);
    }
    for (const trace of this.traces) this.drawTrace(trace, ts);
    this.drawFailures(project, ts, failing);
    this.drawPlugMarks(ts);
    this.drawHover(project, ts);
    this.drawWireless(project, ts, frontDeviceUid(s));
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

  // 自社オフィスでは、社員が机の前でキーボードを打つ
  private officeStaffHits(): StaffHit[] {
    return this.staffMotion.hits(this.map, this.elapsed, this.tileSize());
  }

  // 自社オフィスで、そのマスに机の家具があるか
  private deskAt(x: number, y: number): boolean {
    return (
      this.map?.id === 'hq' &&
      useGameStore.getState().office.furniture.some((f) => f.x === x && f.y === y && isDeskFurniture(f.id, gameEnv))
    );
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
    // 担当の社員を全員描く（担当の順。N108）。足踏みのコマで上下に揺れる。同じ作業場所に重なるときは、左・右・下の順にずらす
    const bob = Math.floor(this.elapsed / STAFF_FRAME_MS) % 2;
    const staffList = useGameStore.getState().staff;
    const used = new Map<number, number>();
    project.crew.forEach((uid, k) => {
      const member = staffList.find((m) => m.uid === uid);
      // 担当が社員の一覧にないのは、状態の誤り（予備の絵で描かない）
      if (!member) throw new Error(`施工中の担当の社員がいない: ${uid}`);
      if (pending.length === 0) return;
      const spot = Math.min(pending.length - 1, index + k);
      const n = used.get(spot) ?? 0;
      used.set(spot, n + 1);
      const at = pending[spot];
      const [dx, dy] = BUILD_SLOTS[n % BUILD_SLOTS.length];
      this.staffRenderer.drawStaff(at.x + dx * ts, at.y - 24 - bob + dy * ts, member.look, member);
    });

    // 施工の進み具合は、ツールバーの帯（Toolbar.tsx）だけに出す。マップの下端には描かない（B13。パソコンも1本にそろえる）
  }

  // 社員のスプライト（16×24 px）。2コマで足踏みする
  // tag があれば、頭の上に名札（名前と職種）を出す。社員の名前が分からないときは出さない
  // 社員の絵。向きが左・右のときは、今の絵を左右に反転する（前向きの絵はまだないため。N95）
  // 机の向き（自社オフィスなら自社の家具、依頼先なら依頼の家具。N171）
  private deskFacingAt(x: number, y: number): Facing {
    const store = useGameStore.getState();
    if (viewingOffice(store)) return store.office.furniture.find((f) => f.x === x && f.y === y && f.id === 'desk')?.facing ?? 'up';
    return this.project()?.contract?.furniture?.find((f) => f.x === x && f.y === y && f.id === 'desk')?.facing ?? 'up';
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
    const map = this.cam.mapSize();
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
  // 選んだアクセスポイントの電波の範囲（薄い円。壁の減衰を含む）と、つながった端末への点線（N152）
  private drawWireless(project: Project, ts: number, selectedUid: string | null): void {
    const engine = this.wireEngine;
    if (!selectedUid || !engine || !this.map) return;
    const ap = project.nodes.find((n) => n.uid === selectedUid);
    const apCategory = gameEnv.devices[ap?.device ?? '']?.category;
    if (!ap || (apCategory !== CATEGORY.accessPoint && apCategory !== CATEGORY.homeRouter)) return;
    const R = WIRELESS_RADIUS;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const tx = ap.x + dx;
        const ty = ap.y + dy;
        if (tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height) continue;
        const d = Math.abs(dx) + Math.abs(dy);
        const walls = engine.wallAt ? wallsBetween(engine.wallAt, ap.x, ap.y, tx, ty) : 0;
        if (d + walls * WALL_LOSS <= R) this.g.rect(tx * ts, ty * ts, ts, ts).fill({ color: 0x62d26f, alpha: 0.12 });
      }
    }
    const pairs = wirelessAssociations({ nodes: project.nodes, links: project.links, segments: project.segments }, engine);
    for (const { ap: a, client } of pairs) {
      if (a.uid !== ap.uid) continue;
      const x0 = a.x * ts + ts / 2;
      const y0 = a.y * ts + ts / 2;
      const x1 = client.x * ts + ts / 2;
      const y1 = client.y * ts + ts / 2;
      const len = Math.hypot(x1 - x0, y1 - y0);
      const steps = Math.max(1, Math.floor(len / 6));
      for (let i = 0; i < steps; i += 2) {
        const t0 = i / steps;
        const t1 = Math.min(1, (i + 1) / steps);
        this.g.moveTo(x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0).lineTo(x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1).stroke({ width: 2, color: 0x62d26f, alpha: 0.8 });
      }
    }
  }

  private drawEffectRange(ts: number): void {
    const store = useGameStore.getState();
    if (!store.placing || focusedProject(store) || !this.input.cursorTile) return;
    const range = gameEnv.furniture?.[store.placing]?.effect?.range;
    if (range === undefined || !this.map) return;
    for (const { tx, ty } of rangeTiles(this.input.cursorTile.tx, this.input.cursorTile.ty, range, this.map.width, this.map.height)) {
      this.g.rect(tx * ts, ty * ts, ts, ts).fill({ color: 0x62d26f, alpha: 0.35 });
    }
  }

  private drawHover(project: Project, ts: number): void {
    if (!this.input.hover) return;
    const node = project.nodes.find((n) => n.uid === this.input.hover!.uid);
    if (!node) return;
    const ok = this.input.hover.reason === null;
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



  // 押した機器の周りに、小さな輪が広がって消える（ボタンを押したのが分かるように）
  private drawPressFx(project: Project, ts: number): void {
    const fx = this.input.pressFx;
    if (!fx || !this.input.pressActive()) return;
    const node = project.nodes.find((n) => n.uid === fx.uid);
    if (!node) return;
    const k = (Date.now() - fx.at) / PRESS_MS;
    this.g.circle(node.x * ts + ts / 2, node.y * ts + ts / 2, ts * (0.35 + 0.3 * k)).stroke({ width: 2, color: 0xffd866, alpha: 1 - k });
  }

  // ---- 機器・家具の移動、ケーブルの端の挿し替え（押してから動かす）----

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
    const tile = s.itemDrag ? this.hit.tileAtClient(s.itemDrag.x, s.itemDrag.y) : this.input.cursorTile;
    if (!tile) return;
    this.drawTileState(tile.tx, tile.ty, ts, this.input.canPlace(id, tile.tx, tile.ty));
  }

  // ドラッグ中の表示。機器・家具は移す先のマスを示し、ケーブルの端は挿し替える先の機器を示して、仮の線を引く
  private drawDrag(ts: number): void {
    const press = this.input.press;
    if (!press?.dragging || !press.at) return;
    const at = press.at;
    const target = press.target;
    if (target.kind === 'node' || target.kind === 'furniture') {
      const tile = this.hit.tileOf(at);
      if (!tile) return;
      const ok = target.kind === 'node' ? this.input.canMoveNode(target.uid, tile.tx, tile.ty) : this.input.canMoveFurniture(target.uid, tile.tx, tile.ty);
      this.drawTileState(tile.tx, tile.ty, ts, ok);
      return;
    }
    const link = this.hit.editLinks()?.find((l) => l.uid === target.linkUid);
    if (!link) return;
    const other = this.hit.editNodes()?.find((n) => n.uid === (target.end === 'a' ? link.b.node : link.a.node));
    const node = this.hit.nodeNear(at, this.hit.editNodes() ?? []);
    const ok = node !== undefined && this.input.canReplug(target.linkUid, target.end, node.uid);
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
    if (this.input.press || s.placing || (s.tool !== 'select' && s.tool !== 'wire')) return;
    const link = this.hit.editLinks()?.find((l) => l.uid === this.input.hoverAnyLink);
    if (!link) return;
    const size = 6 / this.content.scale.x;
    const plugs = plugPoints(link, ts);
    for (const plug of [plugs.a, plugs.b]) {
      this.g.rect(plug.x - size / 2, plug.y - size / 2, size, size).fill({ color: SELECT });
      this.g.rect(plug.x - size / 2, plug.y - size / 2, size, size).stroke({ width: 1 / this.content.scale.x, color: OUTLINE });
    }
  }

  // 配線中のカーソルの横に、ケーブルの長さと費用を出す。カーソルが機器の上なら、その機器までの長さ
  private drawWireCost(from: NetNode, ts: number): void {
    const store = useGameStore.getState();
    const cable = gameEnv.cables[store.wireCable];
    const nodes = this.hit.editNodes();
    const tile = this.hit.tileOf(this.input.wireTo);
    if (!cable || !tile || !nodes) return;
    const end = this.hit.nodeNear(this.input.wireTo, nodes);
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
    text.position.set(this.input.wireTo.x + ts * 0.25, this.input.wireTo.y - ts * 0.25);
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

// 配線の中点（社員が作業する位置）
const midpoint = (link: NetLink, ts: number): Point => {
  const a = link.path[0];
  const b = link.path[link.path.length - 1];
  return { x: ((a[0] + b[0]) / 2) * ts + ts / 2, y: ((a[1] + b[1]) / 2) * ts + ts / 2 };
};
