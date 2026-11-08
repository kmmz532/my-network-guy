// マップの見え方（位置と倍率）と、それを動かす入力（ホイール・ピンチ・背景のドラッグ）。Scene から使う。
// 画面の描き直しと、操作の取り消しは Scene に任せる（CameraHost）。
import { Rectangle, type Application, type Container } from 'pixi.js';
import type { GameMap } from '../data/schema';
import { useGameStore } from '../stores/useGameStore';
import { isPhoneNow } from '../ui/usePhone';
import { fitCamera, fitZoom, panCamera, resizeCamera, screenToMap, stepZoom, zoomCamera, type Camera, type Size } from './camera';
import { distOf, midOf, type Point } from './animation';

// 拡大・縮小ボタンの列は、ツールバーの上の右下の角にある（MapZoomButtons.tsx と同じ寸法。画面の px）
const ZOOM_BUTTON_W = 44;
const ZOOM_BUTTONS_H = 3 * 44 + 2 * 6;
const ZOOM_EDGE = 12;
const TOOLBAR_H = 56;
const TOOLBAR_H_PHONE = 84;
// サンドボックスを開いたときの倍率の下限
// サンドボックスを開いたとき（全体表示より大きい倍率）。
const SANDBOX_OPEN_ZOOM = 2;
// 背景を長押ししてから動き出すまでの時間（ms）
const PAN_LONG_PRESS_MS = 300;
// ホイールの回転を、拡大・縮小1段階に換算する量（px。行単位のホイールは1行 16 px とする）
const WHEEL_STEP_PX = 40;
const WHEEL_LINE_PX = 16;
// 2本指で、指の間の距離がこの倍率を超えたら1段階拡大・縮小する
const PINCH_STEP_RATIO = 1.3;

export interface CameraHost {
  app: Application;
  // 拡大・移動を反映する描画の入れ物
  content: Container;
  map(): GameMap | null;
  tileSize(): number;
  // カメラが変わったあとの描き直し
  redraw(): void;
  // ピンチが始まったとき、配線・押している途中の操作などを取り消す
  cancelOperations(): void;
}

export class MapCamera {
  private camera: Camera | null = null;
  // 画面の大きさ（最後に合わせた値）
  private view: Size = { w: 0, h: 0 };
  // ホイールの回転量の合計（拡大・縮小の1段階に達するまで溜める）
  private wheelAcc = 0;
  // 指の位置（canvas の座標）。2本になったらピンチ（拡大・2本指の移動）
  private touches = new Map<number, Point>();
  private pinch: { dist: number; mid: Point } | null = null;
  // 背景のドラッグ（移動）。長押しのあとに動き出す、または選択の道具で即座に動き出す
  private pan: { last: Point; active: boolean; timer: number | null } | null = null;

  constructor(private host: CameraHost) {}

  get current(): Camera | null {
    return this.camera;
  }

  // 指が2本以上触れている（ピンチが扱う）
  get multiTouch(): boolean {
    return this.touches.size >= 2;
  }

  // 背景をドラッグしている（動き出す前を含む）
  get panning(): boolean {
    return this.pan !== null;
  }

  // マップが変わったとき、全体に合わせ直す
  reset(): void {
    this.camera = null;
    this.layout();
  }

  // マップの位置と倍率を、画面に合わせる。マップが変わったときは全体、画面の大きさが変わったときは倍率を保って合わせ直す（R1）
  layout(): void {
    if (!this.host.map()) return;
    const { app } = this.host;
    app.stage.hitArea = new Rectangle(0, 0, app.screen.width, app.screen.height);
    const view = this.viewSize();
    const map = this.mapSize();
    // 全体表示のときは、画面の大きさに合わせて測り直す（ヘッダーとツールバーの分を除く）
    this.camera = this.camera && !this.camera.fit ? resizeCamera(this.camera, map, this.view, view) : this.fitCameraOf(view);
    this.view = view;
    this.apply();
  }

  // 画面の大きさが変わっていたら合わせ直す（resize の順に関係なく、描画の時点で拾う）
  syncSize(): void {
    const view = this.viewSize();
    if (this.host.map() && (view.w !== this.view.w || view.h !== this.view.h)) this.layout();
  }

  // マップの大きさ（マップの座標の px。拡大率は含まない）
  mapSize(): Size {
    const map = this.host.map();
    const ts = this.host.tileSize();
    return { w: (map?.width ?? 0) * ts, h: (map?.height ?? 0) * ts };
  }

  // 画面の座標をマップの座標に変換する（拡大と配置の補正を除いた、タイルの座標系）
  toMapAt(global: Point): Point {
    return this.camera ? screenToMap(global, this.camera) : { x: 0, y: 0 };
  }

  // 拡大（1）・縮小（-1）を1段階。anchor（画面の座標）の下のマップの点は動かさない。省略時は画面の中央
  zoomBy(dir: 1 | -1, anchor: Point = this.viewCenter()): void {
    const cam = this.camera;
    if (!cam) return;
    this.set(zoomCamera(cam, this.mapSize(), this.view, stepZoom(cam.zoom, dir), anchor));
  }

  fit(): void {
    if (this.host.map()) this.set(this.fitCameraOf(this.view));
  }

  panBy(dx: number, dy: number): void {
    const cam = this.camera;
    if (!cam) return;
    this.set(panCamera(cam, this.mapSize(), this.view, dx, dy));
  }

  // canvas の中の位置（CSS の px）
  canvasPoint(e: { clientX: number; clientY: number }): Point {
    const rect = this.host.app.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // ホイール・Ctrl＋ホイール・トラックパッドのピンチは、カーソルの位置を中心に拡大・縮小する。ブラウザの拡大は起こさない
  onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * WHEEL_LINE_PX : e.deltaY;
    this.wheelAcc += dy;
    if (Math.abs(this.wheelAcc) < WHEEL_STEP_PX) return;
    const dir = this.wheelAcc < 0 ? 1 : -1;
    this.wheelAcc = 0;
    this.zoomBy(dir, this.canvasPoint(e));
  };

  // 指の追跡。2本になったらピンチを始める（拡大・縮小と、2本指の移動）
  onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    this.touches.set(e.pointerId, this.canvasPoint(e));
    if (this.touches.size === 2) this.startPinch();
  };

  onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' || !this.touches.has(e.pointerId)) return;
    this.touches.set(e.pointerId, this.canvasPoint(e));
    if (this.pinch && this.touches.size === 2) this.updatePinch();
  };

  onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinch = null;
  };

  // 画面の座標の位置（at）から背景のドラッグを始める。immediate なら即座に動き出し、そうでなければ長押しのあとに動き出す
  beginPan(at: Point, immediate: boolean): void {
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

  endPan(): void {
    if (this.pan?.timer != null) window.clearTimeout(this.pan.timer);
    this.pan = null;
  }

  // 背景のドラッグ中は動かす。動き出す前は、基準の位置だけを更新する。動かしたときは true
  movePan(p: Point): boolean {
    const pan = this.pan;
    if (!pan) return false;
    if (pan.active) this.panBy(p.x - pan.last.x, p.y - pan.last.y);
    pan.last = p;
    return pan.active;
  }

  private viewSize(): Size {
    return { w: this.host.app.screen.width, h: this.host.app.screen.height };
  }

  private viewCenter(): Point {
    return { x: this.view.w / 2, y: this.view.h / 2 };
  }

  // 位置と倍率を描画に反映し、描き直す（文字の大きさは倍率で割るため、画面上では同じ大きさになる）
  private apply(): void {
    const cam = this.camera;
    if (!cam) return;
    this.host.content.scale.set(cam.zoom);
    this.host.content.position.set(cam.x, cam.y);
    this.host.redraw();
  }

  private set(next: Camera): void {
    const cam = this.camera;
    if (cam && next.zoom === cam.zoom && next.x === cam.x && next.y === cam.y && next.fit === cam.fit) return;
    this.camera = next;
    this.apply();
  }

  // 全体表示で避ける画面の端の分（画面の px）。上はヘッダー、下はツールバー
  private fitInsets(): { top: number; bottom: number } {
    const canvas = this.host.app.canvas.getBoundingClientRect();
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
    if (this.host.map()?.id !== 'hq') return fitCamera(map, view);
    const pad = this.host.tileSize();
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

  // 2本の指の距離と中点を覚え、配線などの途中の操作と背景のドラッグを取り消す
  private startPinch(): void {
    const [a, b] = [...this.touches.values()];
    this.endPan();
    this.host.cancelOperations();
    this.pinch = { dist: distOf(a, b), mid: midOf(a, b) };
    this.host.redraw();
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
}
