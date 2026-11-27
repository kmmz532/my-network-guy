// 案内の指（N163）。押す場所の上で、指が押す動き（tap）・長押し（hold）・始点から終点へなぞる動き（drag）を見せる。
// 動きは手順が始まったときと、操作がないまま IDLE_MS たったときに見せる。プレイヤーが画面を押している間は出さない。指の操作は通す
import { useEffect, useRef, useState } from 'react';
import type { Gesture } from '../sim/guide';
import { Icon } from './Icon';

export interface Point {
  x: number;
  y: number;
}

interface Props {
  // 動きを始め直す鍵（手順が替わったら替わる）
  playKey: string;
  gesture: Gesture;
  // 押す場所（画面の px）。drag は始点
  from: Point;
  // drag の終点
  to: Point | null;
  zIndex: number;
}

// 操作がないまま、もう一度見せるまでの時間（ms）
const IDLE_MS = 6000;
// 動き1回の長さ（ms）と、1度に見せる回数
const CYCLE_MS: Record<Gesture, number> = { tap: 700, hold: 1400, drag: 1600 };
const REPEAT = 3;
// 指の絵の倍率と、絵の中の指先の位置（16×16 の (5, 0)）
const SCALE = 2;
const TIP = { x: 5 * SCALE, y: 0 };
// 波紋の絵の半分の大きさ（16×16 を2倍）
const RING_HALF = 8 * SCALE;

// 動きの中の時刻 t（0〜1）での指の形・位置・波紋のコマ（-1 は出さない）
const frameAt = (gesture: Gesture, t: number, from: Point, to: Point | null): { press: boolean; at: Point; ring: number } => {
  if (gesture === 'tap') {
    // 前半は指す形、後半は押した形で、押した瞬間から波紋が広がる
    if (t < 0.5) return { press: false, at: from, ring: -1 };
    return { press: true, at: from, ring: Math.min(2, Math.floor((t - 0.5) / (0.5 / 3))) };
  }
  if (gesture === 'hold') {
    if (t < 0.2) return { press: false, at: from, ring: -1 };
    return { press: true, at: from, ring: Math.floor(((t - 0.2) / 0.8) * 6) % 3 };
  }
  // drag: 押した形のまま、始点で少し止まってから終点へ動き、終点で少し止まる
  if (to === null) throw new Error('drag の案内に終点がない');
  const k = Math.min(1, Math.max(0, (t - 0.15) / 0.65));
  return { press: true, at: { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k }, ring: -1 };
};

export function GuideFinger({ playKey, gesture, from, to, zIndex }: Props) {
  // 動きを始めた時刻（null は見せていない）
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const pressing = useRef(false);
  const idleTimer = useRef(0);

  // 手順が替わったら、すぐに見せる
  useEffect(() => {
    setStartedAt(performance.now());
  }, [playKey]);

  // 画面を触ったら隠し、操作がないまま IDLE_MS たったら、もう一度見せる
  useEffect(() => {
    const arm = () => {
      window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => {
        if (!pressing.current) setStartedAt(performance.now());
      }, IDLE_MS);
    };
    const onDown = () => {
      pressing.current = true;
      setStartedAt(null);
      arm();
    };
    const onUp = () => {
      pressing.current = false;
      arm();
    };
    const onActivity = () => arm();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    window.addEventListener('keydown', onActivity, true);
    window.addEventListener('wheel', onActivity, true);
    arm();
    return () => {
      window.clearTimeout(idleTimer.current);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('keydown', onActivity, true);
      window.removeEventListener('wheel', onActivity, true);
    };
  }, [playKey]);

  // 見せている間だけ、毎コマ時刻を進める。決めた回数を見せ終えたら隠す
  useEffect(() => {
    if (startedAt === null) return;
    let frame = 0;
    const tick = () => {
      const t = performance.now();
      if (t - startedAt >= CYCLE_MS[gesture] * REPEAT) {
        setStartedAt(null);
        return;
      }
      setNow(t);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [startedAt, gesture]);

  if (startedAt === null) return null;
  const elapsed = Math.max(0, now - startedAt);
  const t = (elapsed % CYCLE_MS[gesture]) / CYCLE_MS[gesture];
  const f = frameAt(gesture, t, from, to);
  const layer = { position: 'fixed' as const, left: 0, top: 0, pointerEvents: 'none' as const, zIndex };

  return (
    <div aria-hidden style={layer}>
      {gesture === 'drag' && to !== null && (
        // なぞった跡の点線（始点から今の指先まで）
        <svg style={{ position: 'fixed', left: 0, top: 0, width: '100vw', height: '100vh', overflow: 'visible' }}>
          <line x1={from.x} y1={from.y} x2={f.at.x} y2={f.at.y} stroke="#ffffff" strokeWidth={2} strokeDasharray="4 4" />
        </svg>
      )}
      {f.ring >= 0 && (
        <div style={{ position: 'fixed', left: f.at.x - RING_HALF, top: f.at.y - RING_HALF, display: 'flex' }}>
          <Icon name={`icon/tap_ring_${f.ring}`} scale={SCALE} />
        </div>
      )}
      <div style={{ position: 'fixed', left: f.at.x - TIP.x, top: f.at.y - TIP.y, display: 'flex' }}>
        <Icon name={f.press ? 'icon/finger_press' : 'icon/finger'} scale={SCALE} />
      </div>
    </div>
  );
}
