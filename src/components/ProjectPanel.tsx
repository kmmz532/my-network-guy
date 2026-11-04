import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import { gameEnv } from '../sim/env';
import { goalStatus } from '../sim/status';
import { useGameStore } from '../stores/useGameStore';
import { ContractDetail } from './ContractDetail';

const panelStyle = {
  background: 'rgba(47, 79, 143, 0.9)',
  color: '#f4f1e6',
  padding: 12,
  borderRadius: 4,
  width: 280,
  fontSize: 14,
} as const;

// 受注中の案件の状況（達成条件の判定・施工・検収の結果）と、施工の依頼・取り消し
export function ProjectPanel() {
  const active = useGameStore((s) => s.active);
  const report = useGameStore((s) => s.lastReport);
  const requestBuild = useGameStore((s) => s.requestBuild);
  const abandon = useGameStore((s) => s.abandon);
  const error = useGameStore((s) => s.lastError);

  if (!active && !report) {
    return (
      <section style={panelStyle}>
        <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>{t('ui.project.title')}</h2>
        <div>{t('ui.project.none')}</div>
      </section>
    );
  }

  return (
    <section style={panelStyle}>
      <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>{t('ui.project.title')}</h2>
      {active && (
        <>
          <div style={{ fontWeight: 'bold' }}>{t(`contract.${active.baseId}.title` as LangKey, active.params)}</div>
          <div>
            {active.phase === 'design'
              ? t('ui.project.design')
              : t('ui.project.build', { percent: active.total ? Math.floor((active.progress / active.total) * 100) : 0 })}
          </div>
          <div>{t('ui.project.cost', { amount: active.cost.toLocaleString('ja-JP') })}</div>
          <div>{t('ui.project.rework', { count: active.rework })}</div>
          <div style={{ margin: '8px 0' }}>
            <ContractDetail
              contract={active.contract}
              baseId={active.baseId}
              params={active.params}
              statuses={goalStatus(active.contract, active.nodes, active.links, gameEnv.engine)}
            />
          </div>
          {active.phase === 'design' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={() => requestBuild()}>{t('ui.project.requestBuild')}</button>
              <button onClick={() => abandon()}>{t('ui.project.abandon')}</button>
            </div>
          )}
        </>
      )}
      {report && (
        <div style={{ marginTop: 8, color: '#ffd866' }}>
          {report.passed
            ? t('ui.report.passed', { stars: report.stars ?? 1, amount: (report.money ?? 0).toLocaleString('ja-JP') })
            : t('ui.report.failed')}
        </div>
      )}
      {error && <div style={{ color: '#ffd866' }}>{t(`ui.error.${error}` as LangKey)}</div>}
    </section>
  );
}
