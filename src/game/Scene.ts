// キャンバスの描画と操作。マップ・機器・配線・社員・パケットを描き、クリックで配置・選択、ドラッグで配線する。
// 描画の状態は store から読むだけで、変更は store の操作を通して行う。
import { Application, Container, Graphics, Text, type Ticker } from 'pixi.js';
import { type GameMap } from '../data/schema';
import { focusedProject, viewingOffice, frontDeviceUid, useGameStore, type Trace } from '../stores/useGameStore';
import { nodeLabel } from '../components/nodeLabel';
import { centerPath, plugPoints } from './linkHit';
import { setMapView } from './mapView';
import { gameEnv } from '../sim/env';
import { engineWithWalls } from '../sim/walls';
import { withWireless } from '../network/engine';
import type { EngineData } from '../network/types';
import { type Facing } from '../sim/facing';
import { dayTintOf, nightnessOf, toHex, type Rgb } from '../sim/dayTint';
import { loadSettings } from '../settings/settings';
import { furnitureOf } from '../contracts/layout';
import { expandActionOf, expansionLocked, officeExpandCostOf, type ExpandSide } from '../sim/office';
import { levelOf } from '../sim/level';
import { compiledNet, isDeskFurniture, type Project } from '../sim/project';
import { colorOfLink, networkColors, type NetworkColors } from '../network/netColor';
import type { Compiled, IssueDetail } from '../network/compile';
import { balance } from 'virtual:game-data';
import { t, tDyn } from '../i18n/t';
import type { NetNode } from '../network/types';
import { CAP as WALL_CAP, drawTileMap } from './TileMap';
import { bindMapCommands } from './mapControl';
import { addKeyLayer, captureKeys } from '../input/keyRouter';
import { MapCamera } from './MapCamera';
import { MapHit } from './MapHit';
import { MapInput } from './MapInput';
import { MapTip } from './MapTip';
import { OfficeStaffMotion, isDesk } from './OfficeStaffMotion';
import { seatedStaff } from '../sim/furniture';
import { cumulativeLengths, type Point } from './animation';
import { minutesPerDay as dayMinutes } from '../sim/clock';
import { type StaffHit } from './staffHit';
import { StaffRenderer } from './StaffRenderer';
import { STAFF_FRAME_MS } from './staffHit';
import { DeviceRenderer } from './DeviceRenderer';
import { FurnitureRenderer } from './FurnitureRenderer';
import { DESK_TOP, DEVICE_FOOT_INSET, isPcOnlyDevice } from './deviceRules';
import { DeviceLabelRenderer } from './DeviceLabelRenderer';
import { NetworkRenderer, PACKET_COUNT, PACKET_SPACING_TILES, PACKET_TILES_PER_SEC } from './NetworkRenderer';
import { EffectRenderer, FLASH_MS } from './EffectRenderer';
import { InteractionRenderer } from './InteractionRenderer';
import { FailureRenderer } from './FailureRenderer';
import { SpeechRenderer } from './SpeechRenderer';

// Scene 自身が描く拡張ボタン・吹き出し・配線操作表示で共用する輪郭色。
const OUTLINE = 0x3b2a33;
// 配線を引く途中の線と、選択状態の表示に使う色。
const SELECT = 0xffd866;
// 機器の設定不備を示す「？」の表示色。
const WARN = 0xffcc33;
// 時刻による色の重ね（N75）の大きさ（地図の外まで覆う。マス・画素の単位）。
const OVERLAY_EXTENT = 20000;
// Scene 内の社員の吹き出しと部屋拡張ボタンの地色。
const BUBBLE_FILL = 0xf4f1e6;
// 撤去の道具で、マウスを乗せた配線を赤みがかった明るさにする。
const HOT_RED = 0xff6b6b;
// 部屋を広げるボタン（「+」）の大きさと表示倍率。通常は半透明で、マウスを乗せたときだけはっきり出す。
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
  private networkRenderer: NetworkRenderer;
  private effectRenderer: EffectRenderer;
  private interactionRenderer: InteractionRenderer;
  private failureRenderer: FailureRenderer;
  private speechRenderer: SpeechRenderer;

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
      helpAt: (p) => this.failureRenderer.helpAt(p),
      redraw: () => this.drawObjects(),
    });
    this.furnitureRenderer = new FurnitureRenderer({
      sprites: this.sprites,
      hoverFurnitureUid: () => this.input.hoverFurnUid,
    });
    this.speechRenderer = new SpeechRenderer({
      bubbles: this.bubbles,
      mapSize: () => this.cam.mapSize(),
      scale: () => this.content.scale.x,
      textResolution: () => this.textResolution(),
    });
    this.staffRenderer = new StaffRenderer({
      sprites: this.sprites,
      background: this.bg,
      bubbles: this.bubbles,
      elapsed: () => this.elapsed,
      scale: () => this.content.scale.x,
      staffMotion: this.staffMotion,
      speech: this.speechRenderer,
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
      nameOf: (node) => {
        const state = useGameStore.getState();
        const nodes = focusedProject(state)?.nodes ?? state.office.nodes;
        return nodeLabel(state, node, nodes);
      },
      guideTarget: () => useGameStore.getState().guideTarget,
    });
    this.networkRenderer = new NetworkRenderer({
      graphics: this.g,
      map: () => this.map,
      wireEngine: () => this.wireEngine,
      tracePath: (trace) => this.tracePath(trace),
    });
    this.effectRenderer = new EffectRenderer({
      graphics: this.g,
      bubbles: this.bubbles,
      input: this.input,
      map: () => this.map,
      scale: () => this.content.scale.x,
      textResolution: () => this.textResolution(),
    });
    this.interactionRenderer = new InteractionRenderer({
      graphics: this.g,
      bubbles: this.bubbles,
      input: this.input,
      hit: this.hit,
      scale: () => this.content.scale.x,
    });
    this.failureRenderer = new FailureRenderer({
      bubbles: this.bubbles,
      spriteTopOf: (node, ts) => this.spriteTopOf(node, ts),
      scale: () => this.content.scale.x,
      textResolution: () => this.textResolution(),
      helpUid: () => useGameStore.getState().helpUid,
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
      // 部屋を広げるボタン（「+」）は1マスの半分。吹き出しと同じクリーム色を使う。
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
      // 時刻による色の重ね（N75）は地図の外まで覆う。
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
    if (this.traceActive() || this.flashActive() || this.networkRenderer.pulseActive() || this.input.pressActive()) {
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
    this.networkRenderer.drawLinkPulse(project, ts);
    // 押した機器の輪
    this.effectRenderer.drawPressFx(project, ts);

    // 配線の線。ドラッグ中、または起点を選んだあとは、起点の機器からカーソルまで伸ばす
    const wireUid = this.input.wireFrom ?? s.wireStart?.uid ?? null;
    const wireNode = wireUid ? project.nodes.find((n) => n.uid === wireUid) : undefined;
    if (wireNode) {
      this.g.moveTo(wireNode.x * ts + ts / 2, wireNode.y * ts + ts / 2);
      this.g.lineTo(this.input.wireTo.x, this.input.wireTo.y);
      this.g.stroke({ width: 2, color: SELECT });
      this.interactionRenderer.drawWireCost(wireNode, ts);
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
    const failing = this.failureRenderer.failuresOf(project);
    if (s.showIp) {
      this.deviceLabelRenderer.drawAddresses(ts, failing);
      this.deviceLabelRenderer.drawPortNames(project, ts);
    }
    // 機器の名前は IP の表示とは別に出す。マップを縮小して1マスが 16 px 未満のときは出さない（文字が読めないため）
    if (s.showNames && ts * this.content.scale.x >= 16) this.deviceLabelRenderer.drawNames(ts, failing, s.showIp);
    if (building) this.staffRenderer.drawBuilding(project, ts);
    else if (this.map?.id === 'hq' && !s.showcase) {
      this.staffRenderer.drawDeskStaff(ts);
      this.staffRenderer.drawWanderers(ts);
    }
    for (const trace of this.traces) this.networkRenderer.drawTrace(trace, ts, this.realElapsed, this.traceStart);
    this.failureRenderer.draw(project, ts, failing);
    this.interactionRenderer.drawPlugMarks(ts);
    this.effectRenderer.drawHover(project, ts);
    this.networkRenderer.drawWireless(project, ts, frontDeviceUid(s));
    this.effectRenderer.drawEffectRange(ts);
    this.interactionRenderer.drawPlacePreview(ts);
    this.interactionRenderer.drawDrag(ts);
    this.effectRenderer.drawFlash(ts);
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
  // テストと検収の失敗を、失敗した機器の上に「×」と理由の文で出す。「？」を押すと直し方を出す。
  // 機器ごとに最初の失敗だけを出す（経路が描けない失敗も出す）
  private tileSize(): number {
    return this.map?.tileSize ?? 32;
  }

  // 文字の解像度（拡大率と画面の密度に合わせ、にじませない）
  private textResolution(): number {
    return Math.max(2, this.content.scale.x * (window.devicePixelRatio || 1));
  }

  private flashActive(): boolean {
    const f = useGameStore.getState().flash;
    return f !== null && Date.now() - f.at < FLASH_MS;
  }

  // 押した機器の周りに、小さな輪が広がって消える（ボタンを押したのが分かるように）
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
