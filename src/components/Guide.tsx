// 初めての概念の案内（P7）。案件を初めて開いたとき、画面の下に社員の吹き出しで次にやることを1行出し、操作する場所を光らせる。
// 操作は縛らない。条件を満たしたら次の手順へ進み、最後まで行くか「飛ばす」で案件の案内を終える（guidesDone に入る）
import { useEffect, useLayoutEffect, useState } from 'react';
import { devices, guides } from 'virtual:game-data';
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import { loadSettings } from '../settings/settings';
import { currentGuideStep, type GuideState, type GuideStep } from '../sim/guide';
import { focusedProject, useGameStore } from '../stores/useGameStore';
import { RADIUS } from '../ui/theme';
import { Icon } from './Icon';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const sameBox = (a: Box | null, b: Box | null): boolean =>
  a === b || (a !== null && b !== null && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);

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

  // 設計中の案件の、まだ終えていない案内だけを出す。案内を出さない設定のときは出さない
  const id = project?.phase === 'design' ? project.baseId : null;
  const steps =
    id !== null && !guidesDone.includes(id) && loadSettings().guide
      ? ((guides[id] as GuideStep[] | undefined) ?? null)
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
  useLayoutEffect(() => {
    if (glowName === null) {
      setGlow(null);
      return;
    }
    const measure = () => {
      const el = document.querySelector(`[data-guide="${glowName}"]`);
      const r = el ? el.getBoundingClientRect() : null;
      const next = r && r.width > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
      setGlow((prev) => (sameBox(prev, next) ? prev : next));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });

  if (id === null || step === null) return null;
  const skip = () => markGuideDone(id);

  return (
    <>
      <style>{'@keyframes guide-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; } }'}</style>
      {glow && (
        <div
          aria-hidden
          style={{
            position: 'fixed',
            left: glow.left - 4,
            top: glow.top - 4,
            width: glow.width + 8,
            height: glow.height + 8,
            border: '3px solid #ffd866',
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
        style={{
          position: 'fixed',
          left: '50%',
          bottom: 'calc(72px * var(--ui-scale, 1))',
          transform: 'translateX(-50%)',
          zIndex: 800,
          zoom: 'var(--ui-scale, 1)',
        }}
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
            whiteSpace: 'nowrap',
            fontSize: 14,
          }}
        >
          <Icon name={`staff/${staffLook}_0`} scale={2} />
          <span>{t(step.key as LangKey)}</span>
          <button
            onClick={skip}
            style={{
              padding: '2px 8px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 13,
              border: '2px solid #3b2a33',
              borderRadius: RADIUS.none,
              background: '#efefef',
              color: '#3b2a33',
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
