import { useEffect, useState } from 'react';
import { t, tDyn } from '../i18n/t';
import { balance } from 'virtual:game-data';
import { useGameStore } from '../stores/useGameStore';
import type { Report } from '../sim/project';
import { Icon } from './Icon';
import { Modal, primaryButton } from './Modal';
import { RADIUS } from '../ui/theme';

// 既存の import 先（modalBack・modalBox）を保つため、部品の定義は Modal.tsx にあり、ここから出す
export { modalBack, modalBox } from './Modal';

const NOTICE_MS = 3000;
// 納品の結果は、パケットが流れ切ってから出す
const REPORT_DELAY_MS = 1500;

// 結果の4項目（費用の割合・失敗回数・納期・設計の不備）。基準は★3の条件、実績は今回の数字。達成の印を付ける
function EvaluationRows({ report }: { report: Report }) {
  const star3 = balance.rating.find((r) => r.stars === 3);
  const costRatio = report.budget && report.budget > 0 ? (report.cost ?? 0) / report.budget : 0;
  const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;
  const late = report.lateDays ?? 0;
  const rows = [
    {
      label: t('report.cost'),
      target: t('report.costTarget', { ratio: pct(star3?.maxCostRatio ?? 0) }),
      actual: `${t('report.costActual', { ratio: pct(costRatio) })}（${t('report.costDetail', {
        devices: (report.costBreakdown?.devices ?? 0).toLocaleString('ja-JP'),
        cable: (report.costBreakdown?.cable ?? 0).toLocaleString('ja-JP'),
      })}）`,
      ok: star3?.maxCostRatio == null || costRatio <= star3.maxCostRatio,
    },
    {
      label: t('report.rework'),
      target: t('report.reworkTarget', { count: star3?.maxRework ?? 0 }),
      actual: t('report.reworkActual', { count: report.rework ?? 0 }),
      ok: star3?.maxRework == null || (report.rework ?? 0) <= star3.maxRework,
    },
    {
      label: t('report.late'),
      target: t('report.onTime'),
      actual: late > 0 ? t('report.lateActual', { days: late }) : t('report.onTime'),
      ok: late === 0,
    },
    {
      label: t('report.design'),
      target: t('report.designTarget', { count: 0 }),
      actual: t('report.designActual', { count: report.designIssues ?? 0 }),
      ok: (report.designIssues ?? 0) === 0,
    },
  ];
  return (
    <div style={{ marginTop: 10, fontSize: 13, textAlign: 'left' }}>
      {rows.map((row) => (
        <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
          <span style={{ width: 72 }}>{row.label}</span>
          <span style={{ width: 96, opacity: 0.85 }}>{t('report.target')} {row.target}</span>
          <span style={{ width: 96 }}>{t('report.actual')} {row.actual}</span>
          <Icon name={row.ok ? 'icon/ok' : 'icon/close'} scale={1} />
        </div>
      ))}
    </div>
  );
}

// 納品の結果。★・報酬・評判の数字のみ。不合格はマップ上の「×」と吹き出しで示すため出さない
export function ReportModal() {
  const report = useGameStore((s) => s.lastReport);
  const dismiss = useGameStore((s) => s.dismissReport);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(false);
    if (!report?.passed) return;
    const id = window.setTimeout(() => setShown(true), REPORT_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [report]);
  if (!report?.passed || !shown) return null;

  const stars = report.stars ?? 1;
  return (
    <Modal onClose={dismiss} primary={dismiss} boxStyle={{ textAlign: 'center', minWidth: 220 }}>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 6 }}>
        {[1, 2, 3].map((i) => (
          <span key={i} style={{ opacity: i <= stars ? 1 : 0.25 }}>
            <Icon name="icon/star" scale={3} />
          </span>
        ))}
      </div>
      <div style={{ fontSize: 20, marginTop: 8 }}>
        <Icon name="icon/money" /> +{(report.money ?? 0).toLocaleString('ja-JP')}
      </div>
      <div style={{ fontSize: 16, marginTop: 4 }}>
        <Icon name="icon/star" /> {t('report.expGain', { exp: report.expGain ?? 0 })}
      </div>
      {(report.rewardDevices ?? []).length > 0 && (
        <div style={{ fontSize: 14, marginTop: 6 }}>
          {t('report.reward', {
            devices: (report.rewardDevices ?? []).map((r) => `${tDyn(`device.${r.device}.name`)} ×${r.count}`).join('・'),
          })}
        </div>
      )}
      <EvaluationRows report={report} />
      <button style={{ ...primaryButton, marginTop: 12 }} onClick={dismiss}>
        <Icon name="icon/ok" />
      </button>
    </Modal>
  );
}

// 画面の上に短く通知を出す（給与の支払いなど）
export function NoticeToast() {
  const notice = useGameStore((s) => s.notice);
  const dismiss = useGameStore((s) => s.dismissNotice);
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(dismiss, NOTICE_MS);
    return () => window.clearTimeout(id);
  }, [notice, dismiss]);
  if (!notice) return null;
  return (
    <div
      style={{
        position: 'absolute',
        top: 48,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(47, 79, 143, 0.95)',
        color: '#ffd866',
        padding: '6px 14px',
        borderRadius: RADIUS.chrome,
        zIndex: 9,
        zoom: 'var(--ui-scale, 1)',
      }}
    >
      {tDyn(notice.key, notice.params)}
    </div>
  );
}
