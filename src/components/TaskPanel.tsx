// 受注中の案件の内容（タイトルと達成条件）。左上に重ねて表示し、折りたためる
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import { evaluateGoal } from '../network/goals';
import { gameEnv } from '../sim/env';
import { compiledNet } from '../sim/project';
import { useGameStore } from '../stores/useGameStore';
import { Icon } from './Icon';

export function TaskPanel() {
  const active = useGameStore((s) => s.active);
  const open = useGameStore((s) => s.taskOpen);
  const setOpen = useGameStore((s) => s.setTaskOpen);
  if (!active) return null;

  const net = compiledNet(active, gameEnv).net;
  const goals = active.contract.goals.map((goal) => {
    const results = evaluateGoal(goal, net, gameEnv.engine);
    const params: Record<string, string> =
      goal.type === 'ping_all'
        ? { nodes: Array.isArray(goal.nodes) ? goal.nodes.join('・') : '' }
        : { from: goal.from, to: goal.to };
    return { text: t(`goal.${goal.type}` as LangKey, params), ok: results.every((r) => r.ok) };
  });

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
        <ul style={{ listStyle: 'none', margin: 0, padding: '0 8px 8px' }}>
          {goals.map((g, i) => (
            <li key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 4 }}>
              <span style={{ opacity: g.ok ? 1 : 0.25, flexShrink: 0 }}>
                <Icon name="icon/ok" scale={1} />
              </span>
              <span style={{ opacity: g.ok ? 0.7 : 1 }}>{g.text}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
