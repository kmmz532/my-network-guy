import { useEffect, useState } from 'react';
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import { useGameStore } from '../stores/useGameStore';

const NOTICE_MS = 3000;
// 納品の結果は、パケットが流れ切ってから出す
const REPORT_DELAY_MS = 1500;

export const modalBack = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(20, 20, 30, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10,
} as const;

export const modalBox = {
  background: '#2f4f8f',
  color: '#f4f1e6',
  padding: 16,
  borderRadius: 6,
  border: '2px solid #f4f1e6',
  maxWidth: 'calc(100vw - 32px)',
} as const;

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
    <div style={modalBack} onClick={dismiss}>
      <div style={{ ...modalBox, textAlign: 'center', minWidth: 220 }}>
        <div style={{ fontSize: 32, color: '#ffd866', letterSpacing: 4 }}>
          {'★'.repeat(stars)}
          <span style={{ opacity: 0.3 }}>{'★'.repeat(3 - stars)}</span>
        </div>
        <div style={{ fontSize: 20, marginTop: 8 }}>💰 +{(report.money ?? 0).toLocaleString('ja-JP')}</div>
        <div style={{ fontSize: 16, marginTop: 4 }}>⭐ +{report.reputationGain ?? 0}</div>
        <button style={{ marginTop: 12, padding: '4px 16px', cursor: 'pointer' }} onClick={dismiss}>
          OK
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
