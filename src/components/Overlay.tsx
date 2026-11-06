import { Fragment, useEffect, useState } from 'react';
import { t, tDyn } from '../i18n/t';
import { balance, contractTemplates } from 'virtual:game-data';
import { pcCountRangeOf } from '../contracts/template';
import { useGameStore } from '../stores/useGameStore';
import type { Report } from '../sim/project';
import { Icon } from './Icon';
import { itemSpriteOf } from './itemSprite';
import { Modal, primaryButton } from './Modal';
import { RADIUS } from '../ui/theme';

// 既存の import 先（modalBack・modalBox）を保つため、部品の定義は Modal.tsx にあり、ここから出す
export { modalBack, modalBox } from './Modal';

const NOTICE_MS = 3000;
// 納品の結果は、パケットが流れ切ってから出す
const REPORT_DELAY_MS = 1500;

// 解放された品目の名前（機材・ケーブル・家具・依頼）
const unlockNameOf = (x: { kind: 'device' | 'cable' | 'furniture' | 'template' | 'contract'; id: string }): string => {
  // 依頼のひな形は台数（{pcCount}）を範囲で入れる。依頼ごとの台数は決まっていないため
  if (x.kind === 'template') {
    const template = contractTemplates.find((c) => c.id === x.id);
    if (!template) throw new Error(`解放された依頼のひな形がない: ${x.id}`);
    const { min, max } = pcCountRangeOf(template);
    return tDyn(`contract.${x.id}.title`, { pcCount: min === max ? String(min) : `${min}〜${max}` });
  }
  if (x.kind === 'contract') return tDyn(`contract.${x.id}.title`);
  return tDyn(`${x.kind === 'device' ? 'device' : x.kind === 'cable' ? 'cable' : 'furniture'}.${x.id}.name`);
};

// 機器・家具の札（絵・名前・台数）。報酬とレベルアップの解放で共有する（N56）。札は横に並び、収まらなければ折り返す
function ItemCards({ items }: { items: { kind: 'device' | 'furniture'; id: string; count?: number }[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 4 }}>
      {items.map((x) => (
        <div key={`${x.kind}_${x.id}`} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', background: '#25406f', border: '1px solid #3b2a33', borderRadius: RADIUS.chrome }}>
          <Icon name={itemSpriteOf(x.kind, x.id)} scale={1} />
          <span>
            {tDyn(`${x.kind}.${x.id}.name`)}
            {x.count !== undefined ? ` ×${x.count}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

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
        <div style={{ fontSize: 16, marginTop: 4 }}>{t('report.expGain', { exp: report.expGain ?? 0 })}</div>
        {(report.levelUps ?? []).map((u) => (
          <div key={u.level} style={{ marginTop: 8, padding: 8, background: '#25406f', fontSize: 14 }}>
            <div style={{ fontWeight: 'bold', color: '#ffd866' }}>{t('report.levelUp.title', { level: u.level })}</div>
            <div>{t('report.levelUp.money', { money: u.money.toLocaleString('ja-JP') })}</div>
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
