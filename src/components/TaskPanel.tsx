// 受注中の案件の内容（タイトル・依頼文・達成条件・ヒント・最初の案件の手順）。左上に重ねて表示し、折りたためる
import type { LangKey } from '../generated/lang-keys';
import { hasKey, t } from '../i18n/t';
import { evaluateGoal } from '../network/goals';
import { goalText } from './goalText';
import { gameEnv } from '../sim/env';
import { compiledNet } from '../sim/project';
import { focusedProject, useGameStore } from '../stores/useGameStore';
import { Icon } from './Icon';

// 最初の案件（c001）の手順。配線・疎通・施工依頼の順に、済んだものに印を付ける
const FIRST_CONTRACT = 'c001_direct_link';

export function TaskPanel() {
  const active = useGameStore(focusedProject);
  const open = useGameStore((s) => s.taskOpen);
  const setOpen = useGameStore((s) => s.setTaskOpen);
  if (!active) return null;

  const net = compiledNet(active, gameEnv).net;
  const goals = active.contract.goals.map((goal) => {
    const results = evaluateGoal(goal, net, gameEnv.engine);
    return { text: goalText(goal), ok: results.every((r) => r.ok) };
  });

  const hintKey = `contract.${active.baseId}.hint`;
  const hasHint = hasKey(hintKey);
  const steps =
    active.baseId === FIRST_CONTRACT
      ? [
          { text: t('ui.task.step.wire'), done: active.links.length > 0 },
          { text: t('ui.task.step.test'), done: goals.every((g) => g.ok) },
          { text: t('ui.task.step.build'), done: active.phase === 'build' },
        ]
      : [];

  return (
    <aside
      style={{
        position: 'absolute',
        top: 44,
        left: 8,
        width: open ? 260 : 'auto',
        background: 'rgba(47, 79, 143, 0.92)',
        color: '#f4f1e6',
        border: '2px solid #3b2a33',
        borderRadius: 4,
        fontSize: 13,
        zIndex: 4,
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          padding: '4px 8px',
          background: 'transparent',
          color: 'inherit',
          border: 'none',
          cursor: 'pointer',
          fontWeight: 'bold',
          textAlign: 'left',
        }}
      >
        <span style={{ width: 10 }}>{open ? '▾' : '▸'}</span>
        <Icon name="icon/mail" scale={1} />
        {open && <span>{t(`contract.${active.baseId}.title` as LangKey, active.params)}</span>}
      </button>
      {open && (
        <div style={{ padding: '0 8px 8px' }}>
          <div style={{ opacity: 0.85, lineHeight: 1.5 }}>
            {t(`contract.${active.baseId}.story` as LangKey, active.params)}
          </div>
          {hasHint && (
            <div style={{ marginTop: 4, color: '#ffd866' }}>
              {t('ui.task.hint', { text: t(hintKey as LangKey) })}
            </div>
          )}
          <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
            {goals.map((g, i) => (
              <li key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 4 }}>
                <span style={{ opacity: g.ok ? 1 : 0.25, flexShrink: 0 }}>
                  <Icon name="icon/ok" scale={1} />
                </span>
                <span style={{ opacity: g.ok ? 0.7 : 1 }}>{g.text}</span>
              </li>
            ))}
          </ul>
          {steps.length > 0 && (
            <>
              <div style={{ marginTop: 8, fontWeight: 'bold' }}>{t('ui.task.steps')}</div>
              <ul style={{ listStyle: 'none', margin: '2px 0 0', padding: 0 }}>
                {steps.map((s, i) => (
                  <li key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 4 }}>
                    <span style={{ opacity: s.done ? 1 : 0.25, flexShrink: 0 }}>
                      <Icon name="icon/ok" scale={1} />
                    </span>
                    <span style={{ opacity: s.done ? 0.7 : 1 }}>{s.text}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
