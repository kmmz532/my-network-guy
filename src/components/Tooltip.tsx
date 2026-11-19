// ゲームの配色のツールチップ。画面の最上位に1つだけ描く（portal）。ポップアップや欄に隠れないよう、document.body に置く
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { balance } from 'virtual:game-data';
import { placeTip, type Anchor } from '../game/tipLayout';
import { TipBox } from './ui/TipBox';
import { isPhoneNow } from '../ui/usePhone';

interface Tip extends Anchor {
  text: string;
}

// 表示中のツールチップ（1つだけ）
let current: Tip | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const setTip = (tip: Tip | null) => {
  current = tip;
  listeners.forEach((l) => l());
};

// 要素・地図の上に出す。anchor は画面の座標（左上と大きさ）
export const showTipAt = (anchor: Anchor, text: string): void => setTip({ ...anchor, text });
export const hideTip = (): void => {
  cancelPendingTip();
  setTip(null);
};

// マウスを乗せてから、Tooltip の部品と同じ遅れで出す（部品で包めない要素に使う）
let pending: number | null = null;
const cancelPendingTip = () => {
  if (pending !== null) window.clearTimeout(pending);
  pending = null;
};
export const showTipLater = (anchor: () => Anchor | null, text: string): void => {
  cancelPendingTip();
  pending = window.setTimeout(() => {
    pending = null;
    const a = anchor();
    if (a) showTipAt(a, text);
  }, balance.tooltip.hoverMs);
};

// 画面に1つだけ置く。App の最上位で描く
export function TooltipHost() {
  const tip = useSyncExternalStore(subscribe, () => current);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!tip || !ref.current) {
      setPos(null);
      return;
    }
    const rect = ref.current.getBoundingClientRect();
    setPos(
      placeTip(tip, { width: rect.width, height: rect.height }, { width: window.innerWidth, height: window.innerHeight }),
    );
  }, [tip]);
  if (!tip) return null;
  const [name, ...rest] = tip.text.split('\n');
  return createPortal(
    <TipBox boxRef={ref} left={pos?.left ?? -9999} top={pos?.top ?? -9999} visible={pos !== null} name={name} rest={rest.length > 0 ? rest.join('\n') : undefined} />,
    document.body,
  );
}

// ボタンなどを包み、マウスでは乗せてから、タッチでは長押しで説明を出す
export function Tooltip({ text, children, style }: { text: string; children: ReactNode; style?: CSSProperties }) {
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const shown = useRef(false);
  const suppressClick = useRef(false);

  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const clearHide = () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };
  const showNow = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    showTipAt({ x: r.left, y: r.top, w: r.width, h: r.height }, text);
    shown.current = true;
  };
  const hideNow = () => {
    clearHide();
    if (shown.current) hideTip();
    shown.current = false;
  };

  return (
    <span
      ref={ref}
      style={{ display: 'inline-flex', ...style }}
      onPointerEnter={(e) => {
        // スマホでは乗せても出さない（押したあとに残って、開いた欄の中身を隠すため。B4）
        if (e.pointerType !== 'mouse' || isPhoneNow()) return;
        clearTimer();
        timer.current = window.setTimeout(showNow, balance.tooltip.hoverMs);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== 'mouse') return;
        clearTimer();
        hideNow();
      }}
      onPointerDown={(e) => {
        if (e.pointerType !== 'touch') return;
        clearTimer();
        clearHide();
        timer.current = window.setTimeout(() => {
          showNow();
          suppressClick.current = true;
        }, balance.tooltip.longPressMs);
      }}
      onPointerUp={(e) => {
        if (e.pointerType !== 'touch') return;
        clearTimer();
        if (shown.current) {
          clearHide();
          hideTimer.current = window.setTimeout(hideNow, balance.tooltip.touchHideMs);
        }
      }}
      onPointerCancel={() => {
        clearTimer();
      }}
      onClick={() => {
        // 押したら説明は消す（開いた先の欄に残さない）
        clearTimer();
        hideNow();
      }}
      onClickCapture={(e) => {
        // 長押しで出した説明のあとのクリックは、ボタンに届けない
        if (!suppressClick.current) return;
        suppressClick.current = false;
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      {children}
    </span>
  );
}
