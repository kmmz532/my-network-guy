import { Fragment, useEffect, useState } from 'react';
import { t, tDyn } from '../i18n/t';
import { balance } from 'virtual:game-data';
import { useGameStore } from '../stores/useGameStore';
import type { Report } from '../sim/project';
import { Icon } from './Icon';
import { ItemCards, unlockNameOf } from './UnlockList';
import { Modal, primaryButton } from './Modal';
import { RADIUS } from '../ui/theme';
import { openOf, visibleNotices } from '../ui/notices';

// 既存の import 先（modalBack・modalBox）を保つため、部品の定義は Modal.tsx にあり、ここから出す
export { modalBack, modalBox } from './Modal';

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
  // 1つの格子に並べ、行の幅をそろえる。基準と実績の見出しは1回だけ出す（N65）。文字が長いときは列の中で折り返す（B14）
  return (
    <div style={{ marginTop: 10, fontSize: 13, textAlign: 'left', display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) minmax(0, 1.4fr) auto', alignItems: 'center', columnGap: 8, rowGap: 2 }}>
      <span />
      <span style={{ opacity: 0.7 }}>{t('report.target')}</span>
      <span style={{ opacity: 0.7 }}>{t('report.actual')}</span>
      <span />
      {rows.map((row) => (
        <Fragment key={row.label}>
          <span>{row.label}</span>
          <span style={{ opacity: 0.85 }}>{row.target}</span>
          <span>{row.actual}</span>
          <Icon name={row.ok ? 'icon/ok' : 'icon/close'} scale={1} />
        </Fragment>
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
  // 箱は画面の高さに収め、本文だけを縦にスクロールする。「閉じる」のボタンは箱の下に固定し、常に見えるようにする（B14）
  return (
    <Modal onClose={dismiss} primary={dismiss} boxStyle={{ textAlign: 'center', minWidth: 220, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100% - 24px)', overflowWrap: 'anywhere' }}>
      <div style={{ minHeight: 0, overflowY: 'auto' }}>
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
        {/* 評判（★の数の積み上げ）と経験値は別の行。経験値の行には星のアイコンを付けない（N55） */}
        <div style={{ fontSize: 16, marginTop: 4 }}>
          <Icon name="icon/star" /> {t('report.reputationGain', { stars: report.stars ?? 0 })}
        </div>
        <div style={{ fontSize: 16, marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
          <Icon name="icon/level" /> {t('report.expGain', { exp: report.expGain ?? 0 })}
        </div>
        {(report.levelUps ?? []).map((u) => (
          <div key={u.level} style={{ marginTop: 8, padding: 8, background: '#25406f', fontSize: 14 }}>
            <div style={{ fontWeight: 'bold', color: '#ffd866', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <Icon name="icon/level" /> {t('report.levelUp.title', { level: u.level })}
            </div>
            <div>{t('report.levelUp.money', { money: u.money.toLocaleString('ja-JP') })}</div>
            {/* このレベルで解放される職種（採用の候補に出る。N84） */}
            {(Object.keys(balance.hiring.jobUnlockLevels) as (keyof typeof balance.hiring.jobUnlockLevels)[]).some((j) => balance.hiring.jobUnlockLevels[j] === u.level) && (
              <div>{t('ui.company.jobs', { jobs: (Object.keys(balance.hiring.jobUnlockLevels) as (keyof typeof balance.hiring.jobUnlockLevels)[]).filter((j) => balance.hiring.jobUnlockLevels[j] === u.level).map((j) => tDyn(`staff.job.${j}`)).join('・') })}</div>
            )}
            {u.devices.length > 0 && (
              <div>
                {t('report.rewardDevices')}
                <ItemCards items={u.devices.map((d) => ({ kind: 'device' as const, id: d.device, count: d.count }))} />
              </div>
            )}
            {/* 絵のある機器・家具は札、ほかの解放（ケーブル・依頼）と部屋の拡張は文字（N56・N59） */}
            {u.unlocks.some((x) => x.kind === 'device' || x.kind === 'furniture') && (
              <div>
                {t('report.levelUp.unlockCards')}
                <ItemCards items={u.unlocks.filter((x) => x.kind === 'device' || x.kind === 'furniture').map((x) => ({ kind: x.kind as 'device' | 'furniture', id: x.id }))} />
              </div>
            )}
            {(u.unlocks.some((x) => x.kind !== 'device' && x.kind !== 'furniture') || balance.office.expand.unlockLevels.includes(u.level)) && (
              <div>
                {t('report.levelUp.unlock', {
                  items: [
                    ...u.unlocks.filter((x) => x.kind !== 'device' && x.kind !== 'furniture').map((x) => unlockNameOf(x)),
                    ...(balance.office.expand.unlockLevels.includes(u.level) ? [t('report.levelUp.expansion')] : []),
                  ].join('・'),
                })}
              </div>
            )}
          </div>
        ))}
        {/* 受け取った機器は、絵と名前と台数の札で並べる（N56）。札は横に並び、収まらなければ折り返す */}
        {(report.rewardDevices ?? []).length > 0 && (
          <div style={{ fontSize: 14, marginTop: 6 }}>
            <div>{t('report.rewardDevices')}</div>
            <ItemCards items={(report.rewardDevices ?? []).map((r) => ({ kind: 'device' as const, id: r.device, count: r.count }))} />
          </div>
        )}
        <EvaluationRows report={report} />
      </div>
      <button style={{ ...primaryButton, marginTop: 12, flexShrink: 0, alignSelf: 'center' }} onClick={dismiss}>
        <Icon name="icon/ok" />
      </button>
    </Modal>
  );
}

// 画面の上に通知を縦に重ねて出す（給与の支払いなど。最大3件・N96）。開く画面がある通知は押せる
export function NoticeToast() {
  const notices = useGameStore((s) => s.notices);
  const openNotice = useGameStore((s) => s.openNotice);
  const dismissNotice = useGameStore((s) => s.dismissNotice);
  const tickNotices = useGameStore((s) => s.tickNotices);
  // 期限を見る（表示の時間が過ぎたものを消し、待っているものを出す）
  useEffect(() => {
    if (notices.length === 0) return;
    const id = window.setInterval(tickNotices, 250);
    return () => window.clearInterval(id);
  }, [notices.length, tickNotices]);
  const visible = visibleNotices(notices);
  if (visible.length === 0) return null;
  return (
    <div style={{ position: 'absolute', top: 48, left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', gap: 4, zIndex: 9, zoom: 'var(--ui-scale, 1)' }}>
      {visible.map((n) => {
        const pressable = openOf(n.kind) !== null;
        return (
          <div
            key={n.id}
            onClick={() => (pressable ? openNotice(n.id) : undefined)}
            style={{
              background: 'rgba(47, 79, 143, 0.95)',
              color: '#ffd866',
              padding: '6px 14px',
              borderRadius: RADIUS.chrome,
              cursor: pressable ? 'pointer' : 'default',
              whiteSpace: 'nowrap',
            }}
          >
            {tDyn(`ui.notice.${n.kind}`, n.params)}
            {n.kind === 'payPause' ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openNotice(n.id);
                }}
                style={{ marginLeft: 10, background: '#ffd866', color: '#3b2a33', border: 'none', padding: '2px 8px', cursor: 'pointer', fontWeight: 'bold' }}
              >
                {t('ui.funds.open')}
              </button>
            ) : (
              <button
                aria-label={t('ui.notice.close')}
                onClick={(e) => {
                  e.stopPropagation();
                  dismissNotice(n.id);
                }}
                style={{ marginLeft: 10, background: 'transparent', color: '#f4f1e6', border: 'none', cursor: 'pointer' }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
