// 上の中央の知らせ（通知・繰り返しの案内・速度の表示）は、1つの縦並びの箱に入れる。位置の数値は箱だけが持つ（N124）
import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n/t';
import { useGameStore, type Speed } from '../../stores/useGameStore';
import { RADIUS } from '../../ui/theme';
import { LoopBanner } from '../LoopBanner';
import { NoticeToast } from '../Overlay';

// 速さを変えたときに画面上部に出す表示は、この時間で消す
const SPEED_NOTE_MS = 1000;

export function TopNotices({ top }: { top: number }) {
  const speed = useGameStore((s) => s.speed);
  // 速さを変えたときの短い表示（1秒で消す）
  const [speedNote, setSpeedNote] = useState<{ speed: Speed; id: number } | null>(null);
  const lastSpeed = useRef(speed);
  useEffect(() => {
    if (lastSpeed.current === speed) return;
    lastSpeed.current = speed;
    const id = Date.now();
    setSpeedNote({ speed, id });
    const timer = window.setTimeout(() => setSpeedNote((n) => (n?.id === id ? null : n)), SPEED_NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [speed]);
  return (
    <div style={{ position: 'absolute', top, left: '50%', transform: 'translateX(-50%)', zIndex: 9, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, zoom: 'var(--ui-scale, 1)' }}>
      <NoticeToast />
      {speedNote && (
        <div
          style={{
            background: 'rgba(47, 79, 143, 0.95)',
            color: '#ffd866',
            padding: '6px 14px',
            borderRadius: RADIUS.chrome,
            pointerEvents: 'none',
            zIndex: 9,
            zoom: 'var(--ui-scale, 1)',
          }}
        >
          {t(`ui.speed.${speedNote.speed}` as const)}
        </div>
      )}
      <LoopBanner />
    </div>
  );
}
