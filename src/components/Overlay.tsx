import { useEffect } from 'react';
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import { useGameStore } from '../stores/useGameStore';

const NOTICE_MS = 3000;

// 検収の結果を出す。合格なら★・報酬・評判、不合格なら理由を出す
export function ReportModal() {
  const report = useGameStore((s) => s.lastReport);
  const dismiss = useGameStore((s) => s.dismissReport);
  if (!report) return null;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(20, 20, 30, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
      }}
    >
      <div style={{ background: '#2f4f8f', color: '#f4f1e6', padding: 20, borderRadius: 6, minWidth: 260 }}>
        <h2 style={{ fontSize: 18, margin: '0 0 12px' }}>{t('ui.report.title')}</h2>
        {report.passed ? (
          <>
            <div style={{ fontSize: 20, color: '#ffd866' }}>
              {t('ui.report.stars', { stars: report.stars ?? 1 })}
            </div>
            <div>{t('ui.report.reward', { amount: (report.money ?? 0).toLocaleString('ja-JP') })}</div>
            <div>{t('ui.report.reputation', { amount: report.reputationGain ?? 0 })}</div>
          </>
        ) : (
          <>
            <div style={{ color: '#ffd866' }}>{t('ui.report.failed')}</div>
            {report.failures.map((f, i) => (
              <div key={i} style={{ fontSize: 13 }}>
                {t('ui.report.failItem', { text: `${t(`error.${f.reason}` as LangKey)}（${f.node}）` })}
              </div>
            ))}
          </>
        )}
        <button style={{ marginTop: 12 }} onClick={dismiss}>
          {t('ui.report.close')}
        </button>
      </div>
    </div>
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
        borderRadius: 4,
        zIndex: 9,
      }}
    >
      {t(notice.key as LangKey, notice.params)}
    </div>
  );
}
