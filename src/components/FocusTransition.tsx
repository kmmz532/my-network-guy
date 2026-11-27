// 自社オフィスと現場の切り替えの演出（N170）。画面の対象が替わるたびに、画面を暗くして中央に場所の札（行き先）を出し、新しい地図を明るくする。
// 入力は止めない（指の操作は通す）。どこかを押せば、その場で終える。動きを減らす設定の端末（prefers-reduced-motion）では、札を出さずに暗くするだけにする
import { useEffect, useRef, useState } from 'react';
import { t, tDyn } from '../i18n/t';
import { useGameStore } from '../stores/useGameStore';
import { Bubble } from './ui/Bubble';
import { Scrim } from './ui/Scrim';

// 演出の長さ（ms）
const DURATION_MS = 600;
// 案内（6）・ウィンドウ（4）より上、知らせの画面より下に置く
const TRANSITION_Z = 7;

const reducedMotion = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function FocusTransition() {
  const focus = useGameStore((s) => s.focus);
  const active = useGameStore((s) => s.active);
  const prev = useRef(focus);
  // 演出の行き先の札（null は演出していない）と、始めた時刻
  const [shown, setShown] = useState<{ label: string; at: number } | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (prev.current === focus) return;
    prev.current = focus;
    // 自社の案件（自社オフィスの写し）は、自社オフィスとして扱う
    const project = focus === null ? null : (active.find((p) => p.id === focus) ?? null);
    const label = project === null || project.contract.inhouse ? t('ui.focus.toOffice') : t('ui.focus.toSite', { title: tDyn(`contract.${project.baseId}.title`, project.params) });
    setShown({ label, at: performance.now() });
  }, [focus, active]);

  useEffect(() => {
    if (shown === null) return;
    let frame = 0;
    const tick = () => {
      const t0 = performance.now();
      if (t0 - shown.at >= DURATION_MS) {
        setShown(null);
        return;
      }
      setNow(t0);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const skip = () => setShown(null);
    window.addEventListener('pointerdown', skip, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointerdown', skip, true);
    };
  }, [shown]);

  if (shown === null) return null;
  // 前半で暗くし、後半で明るくする
  const k = Math.min(1, Math.max(0, (now - shown.at) / DURATION_MS));
  const dim = k < 0.5 ? k * 2 : (1 - k) * 2;
  return (
    <>
      <Scrim fade={dim} zIndex={TRANSITION_Z} />
      {!reducedMotion() && (
        <div aria-live="polite" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: TRANSITION_Z, display: 'flex', alignItems: 'center', justifyContent: 'center', zoom: 'var(--ui-scale, 1)' }}>
          <Bubble>{shown.label}</Bubble>
        </div>
      )}
    </>
  );
}
