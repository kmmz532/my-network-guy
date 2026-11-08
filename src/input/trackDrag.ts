// 画面の部品（DOM）のドラッグを追う。ポインタの移動・離す・中断と、Esc での取り消しを1か所で扱う。
// 動かさずに離したときは「押した」とみなし、ドラッグにしない（onDrop は呼ばない）。Esc は、動き出したあとだけ横取りする。
import { captureKeys as defaultCaptureKeys, type KeyHandler } from './keyRouter';

// これ未満の動きは「押した」とみなし、ドラッグにしない
export const DRAG_THRESHOLD_PX = 4;

// 押した位置から現在の位置までの距離が、しきい値以上か
export const isDragMove = (startX: number, startY: number, x: number, y: number): boolean =>
  Math.hypot(x - startX, y - startY) >= DRAG_THRESHOLD_PX;

// 終わった理由。drop は動かして離した、release は動かさずに離した、cancel はブラウザが中断した、
// escape は Esc で取り消した、abort は decide がドラッグにしなかった、stop は呼び出し側が止めた
export type DragEndReason = 'drop' | 'release' | 'cancel' | 'escape' | 'abort' | 'stop';

export interface DragOptions {
  // 押した位置（画面の座標）
  startX: number;
  startY: number;
  // 追う指・ペン・マウスの識別子。指定すると、ほかのポインタの動きは無視する
  pointerId?: number;
  // 動き出す最初の瞬間に、押した位置からの動き（dx, dy）を見て、ドラッグにするか、やめるかを決める。省略時は常にドラッグ
  decide?: (dx: number, dy: number) => 'drag' | 'abort';
  // 動き出したあとの、ポインタの移動のたび
  onMove?: (x: number, y: number) => void;
  // 動かして離したとき（離した位置）
  onDrop?: (x: number, y: number) => void;
  // 終わったとき。必ず1回だけ呼ぶ（dragged は、動き出したか）
  onEnd?: (end: { dragged: boolean; reason: DragEndReason }) => void;
}

// 登録先。テストでは差し替える
export interface DragDeps {
  target: {
    addEventListener(type: 'pointermove' | 'pointerup' | 'pointercancel', listener: (e: PointerEvent) => void): void;
    removeEventListener(type: 'pointermove' | 'pointerup' | 'pointercancel', listener: (e: PointerEvent) => void): void;
  };
  captureKeys: (handler: KeyHandler) => () => void;
}

// ドラッグを追い始める。戻り値を呼ぶと、呼び出し側から止める（reason は stop）
export function trackDrag(options: DragOptions, deps?: DragDeps): () => void {
  const { target, captureKeys } = deps ?? { target: window, captureKeys: defaultCaptureKeys };
  let dragged = false;
  let ended = false;

  const finish = (reason: DragEndReason): void => {
    if (ended) return;
    ended = true;
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onUp);
    target.removeEventListener('pointercancel', onCancel);
    releaseKeys();
    options.onEnd?.({ dragged, reason });
  };

  const mine = (e: PointerEvent): boolean => options.pointerId === undefined || e.pointerId === options.pointerId;

  const onMove = (e: PointerEvent): void => {
    if (!mine(e)) return;
    if (!dragged) {
      if (!isDragMove(options.startX, options.startY, e.clientX, e.clientY)) return;
      if (options.decide?.(e.clientX - options.startX, e.clientY - options.startY) === 'abort') {
        finish('abort');
        return;
      }
      dragged = true;
    }
    options.onMove?.(e.clientX, e.clientY);
  };

  const onUp = (e: PointerEvent): void => {
    if (!mine(e)) return;
    if (dragged) {
      options.onDrop?.(e.clientX, e.clientY);
      finish('drop');
    } else {
      finish('release');
    }
  };

  const onCancel = (e: PointerEvent): void => {
    if (mine(e)) finish('cancel');
  };

  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onCancel);
  // ドラッグの途中の Esc は、ドラッグだけを取り消す（ほかの Esc の処理には渡さない）
  const releaseKeys = captureKeys((e) => {
    if (e.key !== 'Escape' || !dragged) return false;
    finish('escape');
    return true;
  });

  return () => finish('stop');
}
