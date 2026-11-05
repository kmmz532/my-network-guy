// ゲームの配色のツールチップ。画面の最上位に1つだけ描く（portal）。ポップアップや欄に隠れないよう、document.body に置く
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { balance } from 'virtual:game-data';
import { placeTip, type Anchor } from '../game/tipLayout';
import { RADIUS } from '../ui/theme';

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
export const hideTip = (): void => setTip(null);

const boxStyle: CSSProperties = {
  position: 'fixed',
  zIndex: 1000,
  pointerEvents: 'none',
  background: 'rgba(47, 79, 143, 0.78)',
  color: '#f4f1e6',
  border: '1px solid rgba(59, 42, 51, 0.8)',
  borderRadius: RADIUS.chrome,
  padding: '4px 8px',
  fontSize: 12,
  maxWidth: 'calc(220px * var(--ui-scale, 1))',
  whiteSpace: 'pre-line',
  lineHeight: 1.4,
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
    <div ref={ref} style={{ ...boxStyle, left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? 'visible' : 'hidden' }}>
      {/* 文字は UI の大きさの倍率を受ける。箱の位置は画面の座標のまま（箱には掛けない） */}
      <div style={{ zoom: 'var(--ui-scale, 1)' }}>
        <div style={{ fontWeight: 'bold' }}>{name}</div>
        {rest.length > 0 && <div>{rest.join('\n')}</div>}
      </div>
    </div>,
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
        if (e.pointerType !== 'mouse') return;
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
