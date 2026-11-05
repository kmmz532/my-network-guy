// 開いているウィンドウを描く。種類ごとに中身を選ぶ（機器の画面は DevicePanel、社員の札と一覧は StaffCard）。
// 幅 768 px 未満では、一番手前の1つだけを画面の下に出し、動かさない。
import { useEffect, useState } from 'react';
import { t } from '../i18n/t';
import { frontWindow, clampRect, isNarrow, narrowRect, type Viewport } from '../ui/windows';
import { findDevice, DeviceBody, DeviceTitle } from './DevicePanel';
import { StaffBody, StaffListBody, StaffTitle } from './StaffCard';
import { Window } from './Window';
import { useGameStore, viewportNow } from '../stores/useGameStore';

// 画面の大きさ。変わったら描き直す
function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(viewportNow);
  useEffect(() => {
    const onResize = () => setVp(viewportNow());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return vp;
}

export function Windows({ onTraining }: { onTraining: () => void }) {
  const state = useGameStore();
  const vp = useViewport();
  const narrow = isNarrow(vp);

  // 開いている機器・社員が撤去などでなくなったら、そのウィンドウを閉じる
  useEffect(() => {
    for (const w of state.windows) {
      if (w.kind === 'device' && !findDevice(state, w.ref)) state.closeWindow(w.id);
      if (w.kind === 'staff' && !state.staff.some((m) => m.uid === w.ref)) state.closeWindow(w.id);
    }
  }, [state]);

  const front = frontWindow(state.windows);
  const shown = narrow ? (front ? [front] : []) : [...state.windows].sort((a, b) => a.z - b.z);

  return (
    <>
      {shown.map((w) => (
        <Window
          key={w.id}
          title={
            w.kind === 'device' ? <DeviceTitle uid={w.ref} /> : w.kind === 'staff' ? <StaffTitle uid={w.ref} /> : <b>{t('ui.staff.list.title')}</b>
          }
          rect={narrow ? narrowRect(vp) : clampRect(w, vp)}
          movable={!narrow}
          closeLabel={t('ui.panel.close')}
          onFocus={() => state.focusWindow(w.id)}
          onMove={(x, y) => state.moveWindow(w.id, x, y)}
          onResize={(nw, nh) => state.resizeWindow(w.id, nw, nh)}
          onClose={() => state.closeWindow(w.id)}
        >
          {w.kind === 'device' && <DeviceBody uid={w.ref} />}
          {w.kind === 'staff' && <StaffBody uid={w.ref} onTraining={onTraining} />}
          {w.kind === 'staffList' && <StaffListBody />}
        </Window>
      ))}
    </>
  );
}
