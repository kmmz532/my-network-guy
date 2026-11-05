// 開いているウィンドウを描く。種類ごとに中身を選ぶ（機器の画面は DevicePanel、社員の札と一覧は StaffCard）。
// 機器・社員のウィンドウは、開いているタブをタイトルの帯の下に並べる（タブが1つのときは出さない）。
// 幅 768 px 未満では、一番手前の1つだけを画面の下に出し、動かさない。
import { useEffect, useState, type ReactNode } from 'react';
import { t } from '../i18n/t';
import { frontWindow, clampRect, isNarrow, narrowRect, type Viewport, type WindowItem, type WindowKind } from '../ui/windows';
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

// タブ（機器・社員の名前）と、タイトルの帯に出す中身
const tabLabel = (kind: WindowKind, ref: string): ReactNode => {
  if (kind === 'device') return <DeviceTitle uid={ref} />;
  if (kind === 'staff') return <StaffTitle uid={ref} />;
  return <b>{t('ui.staff.list.title')}</b>;
};

// タブの帯。選ぶのはクリック、閉じるのは小さな×か中ボタンのクリック
function TabStrip({ win, closeLabel, onSelect, onClose }: { win: WindowItem; closeLabel: string; onSelect: (ref: string) => void; onClose: (ref: string) => void }) {
  return (
    <div style={{ flexShrink: 0, background: '#1d3157', borderBottom: '1px solid #3b2a33', padding: '3px 4px' }}>
      <div role="tablist" style={{ display: 'flex', gap: 3, overflowX: 'auto', width: '100%', zoom: 'var(--ui-scale, 1)' }}>
        {win.tabs.map((ref) => {
          const selected = ref === win.active;
          return (
            <div
              key={ref}
              role="tab"
              aria-selected={selected}
              onClick={() => onSelect(ref)}
              // 中ボタンで閉じる。既定の自動スクロールは Window の mousedown で止める
              onAuxClick={(e) => {
                if (e.button !== 1) return;
                e.preventDefault();
                onClose(ref);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                flexShrink: 0,
                maxWidth: 180,
                padding: '2px 3px 2px 8px',
                cursor: 'pointer',
                userSelect: 'none',
                whiteSpace: 'nowrap',
                background: selected ? '#2f4f8f' : '#25406f',
                color: '#f4f1e6',
                border: `1px solid ${selected ? '#f4f1e6' : '#3b2a33'}`,
                borderRadius: 3,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, overflow: 'hidden' }}>{tabLabel(win.kind, ref)}</span>
              <button
                aria-label={closeLabel}
                // タブを選ぶ処理を始めないよう、押した位置の処理を止める
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(ref);
                }}
                style={{ flexShrink: 0, width: 18, height: 18, padding: 0, cursor: 'pointer', background: 'transparent', color: '#f4f1e6', border: 'none', lineHeight: '16px' }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Windows({ onTraining }: { onTraining: () => void }) {
  const state = useGameStore();
  const vp = useViewport();
  const narrow = isNarrow(vp);

  // 画面の大きさが変わったら、開いているウィンドウを画面の中に収める
  const fitWindows = state.fitWindows;
  useEffect(() => {
    fitWindows();
  }, [vp.w, vp.h, fitWindows]);

  // 開いているタブの機器・社員が撤去などでなくなったら、そのタブを閉じる
  useEffect(() => {
    for (const w of state.windows) {
      for (const ref of w.tabs) {
        if (w.kind === 'device' && !findDevice(state, ref)) state.closeTab(w.id, ref);
        if (w.kind === 'staff' && !state.staff.some((m) => m.uid === ref)) state.closeTab(w.id, ref);
      }
    }
  }, [state]);

  const front = frontWindow(state.windows);
  const shown = narrow ? (front ? [front] : []) : [...state.windows].sort((a, b) => a.z - b.z);

  return (
    <>
      {shown.map((w) => (
        <Window
          key={w.id}
          title={tabLabel(w.kind, w.active)}
          tabs={
            w.tabs.length > 1 ? (
              <TabStrip
                win={w}
                closeLabel={t('ui.panel.close')}
                onSelect={(ref) => state.selectTab(w.id, ref)}
                onClose={(ref) => state.closeTab(w.id, ref)}
              />
            ) : null
          }
          rect={narrow ? narrowRect(vp) : clampRect(w, vp)}
          movable={!narrow}
          closeLabel={t('ui.panel.close')}
          onFocus={() => state.focusWindow(w.id)}
          onMove={(x, y) => state.moveWindow(w.id, x, y)}
          onResize={(nw, nh) => state.resizeWindow(w.id, nw, nh)}
          onClose={() => state.closeWindow(w.id)}
        >
          {w.kind === 'device' && <DeviceBody uid={w.active} />}
          {w.kind === 'staff' && <StaffBody uid={w.active} onTraining={onTraining} />}
          {w.kind === 'staffList' && <StaffListBody />}
        </Window>
      ))}
    </>
  );
}
