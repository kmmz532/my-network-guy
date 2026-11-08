// マップへのポインタ入力（押す・ドラッグ・配線・撤去・ホバー）を受け、ストアの操作に変える。画面に出す途中の状態（配線の起点・押している対象・乗せている対象）も持つ。
// 描画は Scene が行い、ここの状態を読む。
import type { Application, FederatedPointerEvent } from 'pixi.js';
import type { GameMap } from '../data/schema';
import type { NetNode } from '../network/types';
import { checkConnect, moveNode, placeDevice, placeInOffice, replugTo, type End, type Project } from '../sim/project';
import { moveFurniture, placeFurniture } from '../sim/furniture';
import { gameEnv } from '../sim/env';
import { coreOf, netTargetOf, viewingOffice, useGameStore, type WireStart } from '../stores/useGameStore';
import { furniture as furnitureData } from 'virtual:game-data';
import { isDragMove } from '../components/rearDrag';
import { cableEndAt, grabsCableEnd, linkAt } from './linkHit';
import { staffAt, type StaffHit } from './staffHit';
import type { Point } from './animation';
import type { MapCamera } from './MapCamera';
import type { MapHit } from './MapHit';
import type { MapTip } from './MapTip';

// 機器を押した瞬間の反応を出す時間（ms）
export const PRESS_MS = 220;
// 指で機器・家具を押してから、持ち上げられるまでの長押しの時間（ms）
const TOUCH_HOLD_MS = 400;
// 指で長押しの前に、この距離（px）以上動いたら、機器をつかまずマップを移動する
const TOUCH_PAN_PX = 8;

// 機器・家具・ケーブルの端を押したあとの対象。動かさずに離せば押した扱い（click）、動かせばドラッグ
export type PressTarget = { kind: 'node'; uid: string } | { kind: 'furniture'; uid: string } | { kind: 'end'; linkUid: string; end: End };
export interface Press {
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

export interface MapInputHost {
  app: Application;
  cam: MapCamera;
  hit: MapHit;
  tip: MapTip;
  map(): GameMap | null;
  tileSize(): number;
  project(): Project | null;
  staffHits(): StaffHit[];
  // 失敗の「？」の下にあれば、その機器の uid
  helpAt(p: { x: number; y: number }): string | undefined;
  redraw(): void;
}

export class MapInput {
  // 配線をドラッグ中の起点と現在位置（マップの座標）
  wireFrom: string | null = null;
  wireTo = { x: 0, y: 0 };
  // 配線の到達先の判定（接続できるか、理由）
  hover: { uid: string; reason: string | null } | null = null;
  // カーソルのあるマス（配置の範囲の表示に使う）
  cursorTile: { tx: number; ty: number } | null = null;
  // マウスを乗せている配線（撤去できる配線だけ。太く明るく描く）、機器、家具（撤去の道具のとき）
  hoverLinkUid: string | null = null;
  hoverNodeUid: string | null = null;
  hoverFurnUid: string | null = null;
  // 任意の道具で、マウスを乗せている機器と配線（ポートの名前を出すときに使う）
  hoverAnyNode: string | null = null;
  hoverAnyLink: string | null = null;
  // 機器・家具・ケーブルの端を押している間の操作（動かすか、押して離すか）
  press: Press | null = null;
  // 機器を押した瞬間の反応（機器の uid と押した時刻）
  pressFx: { uid: string; at: number } | null = null;

  constructor(private host: MapInputHost) {}

  // 配線・押している途中の操作などを取り消す（ピンチが始まったとき）
  cancelOperations(): void {
    this.clearPress();
    this.host.tip.reset();
    this.wireFrom = null;
    this.hover = null;
    useGameStore.getState().cancelWire();
  }

  // 押した位置が背景か（機器・家具・ケーブル・社員のない場所。マップの外の余白を含む）
  isBackground(p: Point, tile: { tx: number; ty: number } | null): boolean {
    if (!tile) return true;
    const project = this.host.project();
    if (project && (this.host.hit.nodeNear(p, project.nodes) || linkAt(project.links, p.x, p.y, this.host.tileSize(), this.host.hit.scale))) return false;
    if (staffAt(this.host.staffHits(), p)) return false;
    const store = useGameStore.getState();
    if (this.host.map()?.id === 'hq' && store.office.furniture.some((f) => f.x === tile.tx && f.y === tile.ty)) return false;
    return true;
  }

  onDown = (e: FederatedPointerEvent): void => {
    // 指が2本のときはピンチが扱う
    if (this.host.cam.multiTouch) return;
    if (e.pointerType === 'touch') this.host.tip.startTouch(e);
    // 中ボタンのドラッグは、どの道具でも動かす
    if (e.button === 1) {
      this.host.cam.beginPan({ x: e.global.x, y: e.global.y }, true);
      return;
    }
    const store = useGameStore.getState();
    const p = this.host.hit.toMap(e);
    // 失敗の「？」を押すと直し方を開く（もう一度押すと閉じる）。ほかを押すと閉じる
    if (e.button !== 2) {
      const helpUid = this.host.helpAt(p);
      if (helpUid) {
        store.setHelpUid(store.helpUid === helpUid ? null : helpUid);
        return;
      }
      if (store.helpUid) store.setHelpUid(null);
    }
    const tile = this.host.hit.tileOf(p);
    // 背景は、長押しのあとにドラッグで動かす。選択の道具では、そのままドラッグで動かす
    if (e.button === 0 && !store.placing && this.isBackground(p, tile)) this.host.cam.beginPan({ x: e.global.x, y: e.global.y }, store.tool === 'select' || e.pointerType === 'touch');
    if (!tile) return;
    // 選択の道具で社員を押すと、社員の札を開く（機器を編集できない状態でも開ける）
    const staffUid = store.tool === 'select' && e.button !== 2 && !store.placing ? staffAt(this.host.staffHits(), p) : undefined;
    if (staffUid) {
      store.toggleWindow('staff', staffUid);
      return;
    }
    // 機器を編集できないとき（納品の結果や施工中）は何もしない
    const nodes = this.host.hit.editNodes();
    if (!nodes) return;
    // 右クリックは、どの道具でも撤去する
    if (e.button === 2) {
      this.removeAt(p, nodes);
      return;
    }
    const node = this.host.hit.nodeNear(p, nodes);
    // 機器を押した瞬間の反応（短い輪を出す）
    if (node && e.button === 0) this.pressFx = { uid: node.uid, at: Date.now() };
    // ケーブルの端は、離すまで挿し替えか押したかを決めない（配置中は、置く操作を優先する）
    if (e.button === 0 && !store.placing && (store.tool === 'select' || store.tool === 'wire')) {
      const end = cableEndAt(this.host.hit.editLinks() ?? [], p.x, p.y, this.host.tileSize(), this.host.hit.scale);
      // 配線の道具で機器の上を押したときは、ケーブルの端より機器を優先する（新しいケーブルを引く・N107）
      if (end && grabsCableEnd(store.tool, node !== undefined)) {
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
        const furniture = this.host.hit.furnitureAt(tile);
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
  removeAt(p: { x: number; y: number }, nodes: readonly NetNode[]): void {
    const store = useGameStore.getState();
    const node = this.host.hit.nodeNear(p, nodes);
    if (node) {
      store.removeNode(node.uid);
      return;
    }
    const tile = this.host.hit.tileOf(p);
    const inOffice = viewingOffice(store);
    const furniture =
      inOffice && tile ? store.office.furniture.find((f) => f.x === tile.tx && f.y === tile.ty) : undefined;
    if (furniture) {
      store.removeFurniture(furniture.uid);
      return;
    }
    const link = this.host.hit.linkUnder(p);
    if (link) store.removeLink(link.uid);
  }

  // 配線の道具で機器を押す。起点を選んだあとは、押した機器のポートの一覧を出す（相手の機器）。
  // 起点がなければドラッグを始める（離した機器と配線する。同じ機器で離したら、ポートの一覧を出す）。空きマスを押すと取り消す
  wireDown(p: { x: number; y: number }, node: NetNode | undefined): void {
    const store = useGameStore.getState();
    if (!node) {
      store.cancelWire();
      this.wireFrom = null;
      this.hover = null;
      this.host.redraw();
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
  openMenuAt(node: NetNode): void {
    const ts = this.host.tileSize();
    const cam = this.host.cam.current;
    if (!cam) return;
    const at = { x: cam.x + (node.x * ts + ts) * cam.zoom, y: cam.y + (node.y * ts + ts / 2) * cam.zoom };
    const rect = this.host.app.canvas.getBoundingClientRect();
    useGameStore.getState().openPortMenu(node.uid, rect.left + at.x + 6, rect.top + at.y - 12);
  }

  // 押したあとの操作を覚える。動かさずに離せば click、動かせばドラッグ
  // hold のとき（指で機器・家具を押したとき）は、TOUCH_HOLD_MS の長押しのあとに動かせるようにする
  startPress(e: FederatedPointerEvent, target: PressTarget, click: () => void, hold = false): void {
    this.clearPress();
    const at = { x: e.global.x, y: e.global.y };
    const press: Press = { x0: e.clientX, y0: e.clientY, target, click, dragging: false, at: null, g0: at, last: at, hold, timer: null };
    if (hold) {
      press.timer = window.setTimeout(() => {
        press.timer = null;
        if (this.press !== press) return;
        press.dragging = true;
        press.at = this.host.hit.toMapAt(press.last);
        this.host.tip.reset();
        this.host.redraw();
      }, TOUCH_HOLD_MS);
    }
    this.press = press;
  }

  // 押している操作を消す（長押しの計時も止める）
  clearPress(): void {
    const press = this.press;
    if (press?.timer != null) window.clearTimeout(press.timer);
    this.press = null;
  }

  // 押した位置から一定以上動いたら、ドラッグを始める。動いている間は、マップの座標の位置を覚えて描き直す。押している間は true
  // 指で長押しの前に TOUCH_PAN_PX 以上動いたときは、機器をつかまず、背景のドラッグ（マップの移動）に切り替える
  pressMove(e: FederatedPointerEvent): boolean {
    const press = this.press;
    if (!press) return false;
    press.last = { x: e.global.x, y: e.global.y };
    if (!press.dragging) {
      if (press.hold) {
        if (Math.hypot(e.clientX - press.x0, e.clientY - press.y0) < TOUCH_PAN_PX) return true;
        this.clearPress();
        this.host.cam.beginPan(press.g0, true);
        this.host.cam.movePan({ x: e.global.x, y: e.global.y });
        return true;
      }
      if (!isDragMove(press.x0, press.y0, e.clientX, e.clientY)) return true;
      press.dragging = true;
      this.host.tip.reset();
    }
    press.at = this.host.hit.toMapAt(press.last);
    this.host.redraw();
    return true;
  }

  // 離したとき。動かさずに離したら押した扱い、動かしていたら離した位置で動かす・挿し替える（置けなければ何もしない）
  finishPress(): void {
    const press = this.press;
    this.clearPress();
    if (!press) return;
    if (!press.dragging) press.click();
    else if (press.at) this.dropPress(press.target, press.at);
    this.host.redraw();
  }

  // ドラッグの途中の Esc は、ドラッグだけを取り消す（ほかの Esc の処理には渡さない）
  onPressKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !this.press?.dragging) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.clearPress();
    this.host.redraw();
  };

  // 離した位置で、機器・家具を移す、またはケーブルの端を別の機器へ挿す。判定は sim の純粋関数と同じ
  dropPress(target: PressTarget, at: Point): void {
    const store = useGameStore.getState();
    if (target.kind === 'end') {
      const node = this.host.hit.nodeNear(at, this.host.hit.editNodes() ?? []);
      if (node && this.canReplug(target.linkUid, target.end, node.uid)) store.replugTo(target.linkUid, target.end, node.uid, null);
      return;
    }
    const tile = this.host.hit.tileOf(at);
    if (!tile) return;
    if (target.kind === 'node') {
      const node = this.host.hit.editNodes()?.find((n) => n.uid === target.uid);
      if (!node || (node.x === tile.tx && node.y === tile.ty)) return;
      // 机の上の機器を、床（家具のないマス）へ離したときは、机ごと動かす（機器とケーブルも一緒に動く・N168）。空いている机へ離すときは機器だけを動かす
      const desk = viewingOffice(store) ? store.office.furniture.find((f) => f.x === node.x && f.y === node.y && f.id === 'desk') : undefined;
      const floorTile = !store.office.furniture.some((f) => f.x === tile.tx && f.y === tile.ty);
      if (desk && floorTile && this.canMoveFurniture(desk.uid, tile.tx, tile.ty)) {
        store.moveFurniture(desk.uid, tile.tx, tile.ty);
        return;
      }
      if (this.canMoveNode(target.uid, tile.tx, tile.ty)) store.moveNode(target.uid, tile.tx, tile.ty);
      return;
    }
    const furniture = store.office.furniture.find((f) => f.uid === target.uid);
    if (!furniture || (furniture.x === tile.tx && furniture.y === tile.ty)) return;
    if (this.canMoveFurniture(target.uid, tile.tx, tile.ty)) store.moveFurniture(target.uid, tile.tx, tile.ty);
  }

  // 機器・家具・配線の端の判定（store の操作と同じ条件で、sim の純粋関数を試す）
  canMoveNode(uid: string, tx: number, ty: number): boolean {
    const s = useGameStore.getState();
    // サンドボックスは、PC を床にも置ける（store の移動と同じ条件にする）
    const map = this.host.map();
    return map !== null && moveNode(coreOf(s), uid, tx, ty, gameEnv, netTargetOf(s), map, s.mode === 'sandbox').ok;
  }

  canMoveFurniture(uid: string, tx: number, ty: number): boolean {
    const s = useGameStore.getState();
    return s.maps.hq !== undefined && moveFurniture(coreOf(s), uid, tx, ty, s.maps.hq).ok;
  }

  canReplug(linkUid: string, end: End, nodeUid: string): boolean {
    const s = useGameStore.getState();
    return replugTo(coreOf(s), linkUid, end, nodeUid, null, gameEnv, netTargetOf(s)).ok;
  }

  // 品目（機材・家具）を、マスに置けるか（インベントリの欄からのドラッグと、配置の表示で使う）
  canPlace(id: string, tx: number, ty: number): boolean {
    const s = useGameStore.getState();
    const core = coreOf(s);
    const hq = s.maps.hq;
    if (!hq) return false;
    if (id in furnitureData) return placeFurniture(core, id, tx, ty, hq).ok;
    if (viewingOffice(s)) return placeInOffice(core, id, tx, ty, hq, gameEnv, s.mode === 'sandbox').ok;
    const map = this.host.map();
    return map !== null && placeDevice(core, id, tx, ty, map, gameEnv).ok;
  }

  onMove = (e: FederatedPointerEvent): void => {
    if (this.host.cam.multiTouch) return;
    if (this.host.cam.movePan({ x: e.global.x, y: e.global.y })) return;
    if (this.pressMove(e)) return;
    if (e.pointerType !== 'touch') this.host.tip.updateMouse(e);
    const p = this.host.hit.toMap(e);
    this.cursorTile = this.host.hit.tileOf(p);
    const store = useGameStore.getState();
    // 配線の途中でなければ、マウスを乗せた対象を覚える
    if (!this.wireFrom && !store.wireStart) {
      this.updateHover(e);
      if (store.placing) this.host.redraw();
      return;
    }
    this.wireTo = p;
    this.aim();
    this.host.redraw();
  };

  // 配線の到達先を判定する。接続できれば緑、できなければ赤の枠と×（理由は配線の判定と同じ）
  aim(): void {
    const store = useGameStore.getState();
    const nodes = this.host.hit.editNodes();
    // ドラッグ中はおまかせのポート、起点を選んだあとは起点のポートを使う
    const start: WireStart | null = this.wireFrom ? { uid: this.wireFrom, port: null } : store.wireStart;
    const target = start && nodes ? this.host.hit.nodeNear(this.wireTo, nodes) : undefined;
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
  updateHover(e: FederatedPointerEvent): void {
    const store = useGameStore.getState();
    const p = this.host.hit.toMap(e);
    const tile = this.host.hit.tileOf(p);
    // ポートの名前を出すための、任意の道具でマウスを乗せた機器と配線
    const project = this.host.project();
    const anyNode = project ? this.host.hit.nodeNear(p, project.nodes)?.uid ?? null : null;
    const anyLink = project ? linkAt(project.links, p.x, p.y, this.host.tileSize(), this.host.hit.scale)?.uid ?? null : null;
    const anyChanged = anyNode !== this.hoverAnyNode || anyLink !== this.hoverAnyLink;
    this.hoverAnyNode = anyNode;
    this.hoverAnyLink = anyLink;
    const removing = store.tool === 'remove' && !store.placing;
    const nodes = removing ? this.host.hit.editNodes() : null;
    const node = nodes ? this.host.hit.nodeNear(p, nodes) : undefined;
    const inOffice = viewingOffice(store);
    const furniture =
      removing && inOffice && tile ? store.office.furniture.find((f) => f.x === tile.tx && f.y === tile.ty) : undefined;
    const link = store.placing ? undefined : this.host.hit.linkUnder(p);
    const next = { node: node?.uid ?? null, furniture: furniture?.uid ?? null, link: link?.uid ?? null };
    if (next.node === this.hoverNodeUid && next.furniture === this.hoverFurnUid && next.link === this.hoverLinkUid) {
      if (anyChanged) this.host.redraw();
      return;
    }
    this.hoverNodeUid = next.node;
    this.hoverFurnUid = next.furniture;
    this.hoverLinkUid = next.link;
    this.host.redraw();
  }

  onUp = (e: FederatedPointerEvent): void => {
    if (e.pointerType === 'touch') this.host.tip.endTouch();
    this.host.cam.endPan();
    if (this.press) {
      this.finishPress();
      return;
    }
    if (!this.wireFrom) return;
    const from = this.wireFrom;
    this.wireFrom = null;
    this.hover = null;
    const store = useGameStore.getState();
    const nodes = this.host.hit.editNodes();
    const target = nodes ? this.host.hit.nodeNear(this.host.hit.toMap(e), nodes) : undefined;
    if (target && target.uid !== from) {
      // ドラッグで機器から機器へ離した場合は、両端とも「おまかせ」で配線する
      store.connect(from, target.uid, store.wireCable);
    } else if (target) {
      // 押して離した場合は、起点のポートの一覧を出す
      this.openMenuAt(target);
    }
    this.host.redraw();
  };

  dropWire = (): void => {
    this.host.cam.endPan();
    this.clearPress();
    this.wireFrom = null;
    this.hover = null;
    this.host.redraw();
  };

  onCanvasLeave = (): void => this.clearMapHover();

  // ポインタの下が canvas でないとき（DOM のウィンドウなどが覆っているとき）は、マップの説明と乗せた対象を消す
  onWindowPointerMove = (e: PointerEvent): void => {
    if (document.elementFromPoint(e.clientX, e.clientY) === this.host.app.canvas) return;
    this.clearMapHover();
  };

  // マップの説明と、マウスを乗せた対象（機器・配線・家具）を消す
  clearMapHover(): void {
    this.host.tip.reset();
    const hovering = this.hoverLinkUid !== null || this.hoverNodeUid !== null || this.hoverFurnUid !== null || this.hoverAnyNode !== null || this.hoverAnyLink !== null;
    this.hoverLinkUid = null;
    this.hoverNodeUid = null;
    this.hoverFurnUid = null;
    this.hoverAnyNode = null;
    this.hoverAnyLink = null;
    if (hovering) this.host.redraw();
  }

  pressActive(): boolean {
    return this.pressFx !== null && Date.now() - this.pressFx.at < PRESS_MS;
  }
}
