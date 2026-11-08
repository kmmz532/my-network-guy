// 受注中の案件の内容（タイトル・依頼文・達成条件・ヒント・最初の案件の手順）。左上に重ねて表示し、折りたためる。
// 達成条件は最後のテスト（または検収）の結果で ✓／× を出す。× は失敗した機器を選んで機器の画面を開く
import { labelOfUid } from './nodeLabel';
import { hasKey, t, tDyn } from '../i18n/t';
import { goalText } from './goalText';
import { focusedProject, useGameStore } from '../stores/useGameStore';
import { Icon } from './Icon';
import { RADIUS } from '../ui/theme';
import { secondaryButton } from './Modal';
import { familiarKeyOf } from '../sim/familiar';
import { usePhone } from '../ui/usePhone';
import { useEffect, useState } from 'react';

// 最初の案件（c001）の手順。配線・疎通・施工依頼の順に、済んだものに印を付ける
const FIRST_CONTRACT = 'c001_direct_link';

// top は札の上端（ヘッダーの下）。狭い画面では、案件を受けたときに畳んだ状態（件名だけ）で出す
export function TaskPanel() {
  const active = useGameStore(focusedProject);
  const open = useGameStore((s) => s.taskOpen);
  const setOpen = useGameStore((s) => s.setTaskOpen);
  const check = useGameStore((s) => s.check);
  const openWindow = useGameStore((s) => s.openWindow);
  const setTool = useGameStore((s) => s.setTool);
  const phone = usePhone();
  const activeId = active?.id ?? null;
  // 同じ依頼の型紙があるか（「型紙を使う」を出す。N70）
  const hasBlueprint = useGameStore((s) => (active ? s.familiarity.blueprints[familiarKeyOf(active.kind, active.baseId, active.contract.map)] !== undefined : false));
  const useBlueprint = useGameStore((s) => s.useBlueprint);
  // 「型紙を使う」が失敗したときの理由（ui.error.* のキー）。案件が変わったら消す
  const [blueprintError, setBlueprintError] = useState<string | null>(null);
  useEffect(() => {
    if (phone && activeId !== null) setOpen(false);
  }, [phone, activeId, setOpen]);
  useEffect(() => {
    setBlueprintError(null);
  }, [activeId]);
  if (!active) return null;

  // 最後のテスト（または検収）の結果。この案件のものだけを使う。結果がなければ ok は null（未判定）
  const result = check && check.projectId === active.id ? check.goals : null;
  const warnings = check && check.projectId === active.id ? (check.warnings ?? []) : [];
  const goals = active.contract.goals.map((goal, i) => {
    const g = result?.[i];
    return { text: goalText(goal, (id) => labelOfUid(useGameStore.getState(), id, active.nodes)), ok: g ? g.ok : null, node: g?.failures[0]?.node ?? null };
  });

  const hintKey = `contract.${active.baseId}.hint`;
  const hasHint = hasKey(hintKey);
  const steps =
    active.baseId === FIRST_CONTRACT
      ? [
          { text: t('ui.task.step.wire'), done: active.links.length > 0 },
          { text: t('ui.task.step.test'), done: active.testedOk },
          { text: t('ui.task.step.build'), done: active.phase === 'build' },
        ]
      : [];

  return (
    <aside
      // 案内の吹き出しを、スマホで案件の欄の下に置くために測る（B2）
      data-task-panel
      style={{
        width: open ? 260 : 'auto',
        maxWidth: phone ? 'calc((100vw - 16px) / var(--ui-scale, 1))' : undefined,
        background: 'rgba(47, 79, 143, 0.92)',
        color: '#f4f1e6',
        border: '2px solid #3b2a33',
        borderRadius: RADIUS.chrome,
        fontSize: 13,
        zIndex: 4,
        zoom: 'var(--ui-scale, 1)',
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
        {/* 畳んだときは、狭い画面だけ件名を出す（PC は従来どおり開いたときだけ） */}
        {(open || phone) && (
          <span style={phone && !open ? { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : undefined}>
            {tDyn(`contract.${active.baseId}.title`, active.params)}
          </span>
        )}
      </button>
      {open && (
        <div style={{ padding: '0 8px 8px' }}>
          <div style={{ opacity: 0.85, lineHeight: 1.5 }}>
            {tDyn(`contract.${active.baseId}.story`, active.params)}
          </div>
          {hasHint && (
            <div style={{ marginTop: 4, color: '#ffd866' }}>
              {t('ui.task.hint', { text: tDyn(hintKey) })}
            </div>
          )}
          {active.phase === 'design' && hasBlueprint && (
            <>
              <button
                style={{ ...secondaryButton, marginTop: 6 }}
                onClick={() => setBlueprintError(useBlueprint())}
              >
                {t('ui.blueprint.use')}
              </button>
              {blueprintError && <div style={{ marginTop: 4, color: '#ffd866' }}>{tDyn(`ui.error.${blueprintError}`)}</div>}
            </>
          )}
          <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
            {goals.map((g, i) => {
              // × は失敗した機器を選び、機器の画面を開く（失敗の機器がないものは押せない）
              const icon = <Icon name={g.ok === false ? 'icon/close' : 'icon/ok'} scale={1} />;
              return (
                <li key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 4 }}>
                  {g.ok === false && g.node ? (
                    <button
                      aria-label={t('ui.check.open')}
                      title={t('ui.check.open')}
                      onClick={() => {
                        setTool('select');
                        if (g.node) openWindow('device', g.node);
                      }}
                      style={{ flexShrink: 0, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit' }}
                    >
                      {icon}
                    </button>
                  ) : (
                    <span style={{ opacity: g.ok === null ? 0.25 : 1, flexShrink: 0 }}>{icon}</span>
                  )}
                  <span style={{ opacity: g.ok === true ? 0.7 : 1 }}>{g.text}</span>
                </li>
              );
            })}
          </ul>
          {warnings.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 'bold', color: '#ffd866' }}>{t('ui.check.warnings')}</div>
              <ul style={{ listStyle: 'none', margin: '2px 0 0', padding: 0 }}>
                {warnings.map((warning, i) => (
                  <li key={`${warning.id}-${warning.a}-${warning.b}-${i}`} style={{ marginTop: 4, color: '#ffd866' }}>
                    <span>{tDyn(`warn.${warning.id}`)}</span>
                    <div style={{ fontSize: 11, opacity: 0.9 }}>
                      {labelOfUid(useGameStore.getState(), warning.a, active.nodes)} / {labelOfUid(useGameStore.getState(), warning.b, active.nodes)}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
