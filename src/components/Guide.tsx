// 初めての概念の案内（P7）。案件を初めて開いたとき、画面の下に社員の吹き出しで次にやることを1行出し、操作する場所を光らせる。
// 操作は縛らない。条件を満たしたら次の手順へ進み、最後まで行くか「飛ばす」で案件の案内を終える（guidesDone に入る）
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePhone } from '../ui/usePhone';
import { devices, guides } from 'virtual:game-data';
import { t, tDyn } from '../i18n/t';
import { loadSettings } from '../settings/settings';
import { currentGuideStep, type GuideState } from '../sim/guide';
import { focusedProject, useGameStore } from '../stores/useGameStore';
import { RADIUS } from '../ui/theme';
import { Icon } from './Icon';
import { secondaryButton } from './Modal';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const sameBox = (a: Box | null, b: Box | null): boolean =>
  a === b || (a !== null && b !== null && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);

// 光らせる枠の、ボタンの外側への出っ張り（画面の px）
const GLOW_OUTSET_PX = 3;

// スマホの吹き出しの上端（HUD と案件の欄の下端の、下の px）。どちらも測れないときは、画面の上の余白を使う
const belowHud = (): number => {
  const bottoms = ['[data-hud]', '[data-task-panel]']
    .map((sel) => document.querySelector(sel))
    .filter((el): el is Element => el !== null)
    .map((el) => el.getBoundingClientRect().bottom);
  return bottoms.length > 0 ? Math.max(...bottoms) + 8 : 8;
};

const categoryOf = (device: string): string =>
  (devices as Record<string, { category: string } | undefined>)[device]?.category ?? '';

export function Guide() {
  const project = useGameStore(focusedProject);
  const officeNodes = useGameStore((s) => s.office.nodes);
  const officeLinks = useGameStore((s) => s.office.links);
  const tool = useGameStore((s) => s.tool);
  const owned = useGameStore((s) => s.owned);
  const check = useGameStore((s) => s.check);
  const windows = useGameStore((s) => s.windows);
  const guidesDone = useGameStore((s) => s.guidesDone);
  const staffLook = useGameStore((s) => s.staff[0]?.look ?? 'blue');
  const setGuideTarget = useGameStore((s) => s.setGuideTarget);
  const markGuideDone = useGameStore((s) => s.markGuideDone);
  // 案件ごとに、完了した手順の数を覚える（画面の中だけ。条件を満たした手順は戻らない）
  const [progress, setProgress] = useState<{ id: string; index: number }>({ id: '', index: 0 });
  // 光らせるツールバーのボタンの位置（画面の座標）
  const [glow, setGlow] = useState<Box | null>(null);
  const phone = usePhone();
  // 横にスクロールするツールバーで、光らせるボタンを見える位置へ寄せたときの対象（同じ手順で何度も寄せないため）
  const scrolledFor = useRef<string | null>(null);

  // 設計中の案件の、まだ終えていない案内だけを出す。案内を出さない設定のときは出さない
  const id = project?.phase === 'design' ? project.baseId : null;
  const steps =
    id !== null && !guidesDone.includes(id) && loadSettings().guide
      ? (guides[id] ?? null)
      : null;

  const nodes = project ? project.nodes : officeNodes;
  const links = project ? project.links : officeLinks;
  const state: GuideState = {
    tool,
    nodes,
    links,
    owned,
    testPassed: project !== null && check !== null && check.projectId === project.id && check.goals.length > 0 && check.goals.every((g) => g.ok),
    openRefs: windows.filter((w) => w.kind === 'device').flatMap((w) => w.tabs),
    categoryOf,
  };

  const index = progress.id === id ? progress.index : 0;
  const current = steps ? currentGuideStep(steps, state, index) : null;
  const currentIndex = current ? current.index : -1;

  // 完了した手順の数を覚える。すべて終えたら案件の案内を終える
  useEffect(() => {
    if (id === null || steps === null) return;
    if (current === null) {
      markGuideDone(id);
      return;
    }
    if (progress.id !== id || progress.index !== currentIndex) setProgress({ id, index: currentIndex });
  }, [id, steps, currentIndex, progress.id, progress.index, markGuideDone]);

  const step = current ? current.step : null;
  // 対象が機器（案件の機器の ref）なら、マップの機器を光らせるため、ストアに置く（描画は行わない）
  const deviceTarget = step !== null && nodes.some((n) => n.uid === step.target) ? step.target : null;
  useEffect(() => {
    setGuideTarget(deviceTarget);
  }, [deviceTarget, setGuideTarget]);
  useEffect(() => () => setGuideTarget(null), [setGuideTarget]);

  // 対象がツールバーのボタン（data-guide の名前）なら、その位置を測って枠を重ねる。画面の大きさが変わったら測り直す
  const glowName = step !== null && deviceTarget === null ? step.target : null;
  // 対象のボタンの位置を測って枠に入れる（画面の px のまま。同じ位置なら状態を変えない）
  const measureGlow = useCallback(() => {
    if (glowName === null) return;
    const el = document.querySelector(`[data-guide="${glowName}"]`);
    const r = el ? el.getBoundingClientRect() : null;
    const next = r && r.width > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
    setGlow((prev) => (sameBox(prev, next) ? prev : next));
  }, [glowName]);

  useLayoutEffect(() => {
    if (glowName === null) {
      scrolledFor.current = null;
      setGlow(null);
      return;
    }
    // 狭い画面で、横にスクロールする外に対象があるときは、一度だけ見える位置へ寄せる
    if (phone && scrolledFor.current !== glowName) {
      const el = document.querySelector(`[data-guide="${glowName}"]`);
      if (el) {
        scrolledFor.current = glowName;
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
    measureGlow();
  });

  // 枠の位置は、ツールバーの並びや大きさが変わったとき・画面の大きさやスクロールが変わったときに測り直す（描画の前に1回にまとめる）
  useEffect(() => {
    if (glowName === null) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measureGlow);
    };
    const target = document.querySelector(`[data-guide="${glowName}"]`);
    const bar = document.querySelector('[data-toolbar]');
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    if (target) observer?.observe(target);
    if (bar) observer?.observe(bar);
    window.addEventListener('resize', schedule);
    // 横にスクロールすると、枠の位置もずれるため、スクロールのたびに測り直す
    window.addEventListener('scroll', schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [glowName, measureGlow]);

  if (id === null || step === null) return null;
  const skip = () => markGuideDone(id);
  // スマホの吹き出しは、HUD と案件の欄の下に置く（ツールバー・インベントリ・シートの操作の欄とは重ならない）
  const topBelowHud = phone ? belowHud() : 0;

  return (
    <>
      <style>{'@keyframes guide-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; } }'}</style>
      {glow && (
        <div
          aria-hidden
          style={{
            // ボタンの外側に 3 px（画面の px。この枠は UI の大きさの zoom の外にあるので換算しない）。枠は border-box で、枠の内側がボタンの外形に接する
            position: 'fixed',
            boxSizing: 'border-box',
            left: glow.left - GLOW_OUTSET_PX,
            top: glow.top - GLOW_OUTSET_PX,
            width: glow.width + GLOW_OUTSET_PX * 2,
            height: glow.height + GLOW_OUTSET_PX * 2,
            border: `${GLOW_OUTSET_PX}px solid #ffd866`,
            boxShadow: '0 0 0 2px #3b2a33',
            borderRadius: RADIUS.none,
            pointerEvents: 'none',
            zIndex: 800,
            animation: 'guide-blink 0.8s steps(1, end) infinite',
          }}
        />
      )}
      <div
        role="status"
        // 外枠は指の操作を通す（下のインベントリ・ツールバー・マップを押せる）。押せる部品（「飛ばす」）だけが指の操作を受け取る（B2）
        style={
          phone
            ? {
                // HUD と案件の欄の下に置く。ツールバーやインベントリの欄とは重ならない
                position: 'fixed',
                left: '50%',
                top: topBelowHud,
                pointerEvents: 'none',
                transform: 'translateX(-50%)',
                // 幅は画面の左右に 12 px ずつ余白を残す（吹き出しの中の文字が細かく折り返さないため）
                width: 'calc((100vw - 24px) / var(--ui-scale, 1))',
                zIndex: 800,
                zoom: 'var(--ui-scale, 1)',
              }
            : {
                position: 'fixed',
                left: '50%',
                bottom: 'calc(72px * var(--ui-scale, 1))',
                transform: 'translateX(-50%)',
                pointerEvents: 'none',
                zIndex: 800,
                zoom: 'var(--ui-scale, 1)',
              }
        }
      >
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            background: '#f4f1e6',
            color: '#3b2a33',
            border: '3px solid #3b2a33',
            boxShadow: '0 0 0 2px #f4f1e6',
            borderRadius: RADIUS.none,
            whiteSpace: phone ? 'normal' : 'nowrap',
            fontSize: 14,
          }}
        >
          {/* 狭い画面では、社員の絵と「飛ばす」は縮めず、文字の欄が残りの幅を使う */}
          {phone ? (
            <span style={{ flexShrink: 0, display: 'flex' }}>
              <Icon name={`staff/${staffLook}_0`} scale={2} />
            </span>
          ) : (
            <Icon name={`staff/${staffLook}_0`} scale={2} />
          )}
          <span style={phone ? { flex: 1, minWidth: 0 } : undefined}>{tDyn(step.key)}</span>
          <button
            onClick={skip}
            style={{
              ...secondaryButton,
              pointerEvents: 'auto',
              flexShrink: 0,
              whiteSpace: 'nowrap',
              padding: '2px 8px',
              fontSize: 13,
            }}
          >
            {t('ui.guide.skip')}
          </button>
          {/* 吹き出しの尻尾（社員の方向を向く） */}
          <span
            aria-hidden
            style={{
              position: 'absolute',
              left: '50%',
              bottom: -9,
              width: 10,
              height: 10,
              marginLeft: -5,
              background: '#f4f1e6',
              borderRight: '3px solid #3b2a33',
              borderBottom: '3px solid #3b2a33',
              transform: 'rotate(45deg)',
            }}
          />
        </div>
      </div>
    </>
  );
}
