// 開いているウィンドウを描く。種類ごとに中身を選ぶ（機器の画面は DevicePanel、社員の札と一覧は StaffCard）。
// 機器・社員のウィンドウは、開いているタブをタイトルの帯の下に並べる（タブが1つのときは出さない）。タブが2つ以上あるときは、タイトルの帯に種類の名前（機器のプロパティ・社員のプロパティ）を出す。
// 幅 768 px 未満では、一番手前の1つだけを画面の下に出し、動かさない。
import { useEffect, useState, type ReactNode } from 'react';
import { t } from '../i18n/t';
import { frontWindow, clampRect, isNarrow, narrowRect, type Viewport, type WindowItem, type WindowKind } from '../ui/windows';
import { findDevice, DeviceBody, DeviceTitle } from './DevicePanel';
import { StaffBody, StaffListBody, StaffTitle } from './StaffCard';
import { Window } from './Window';
import { Tabs, TAB_COLORS } from './Tabs';
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
  return <b style={{ whiteSpace: 'nowrap' }}>{t('ui.staff.list.title')}</b>;
};

// タブの帯。選ぶのはクリック、閉じるのは小さな×か中ボタンのクリック（Tabs が受け持つ）
function TabStrip({ win, closeLabel, onSelect, onClose }: { win: WindowItem; closeLabel: string; onSelect: (ref: string) => void; onClose: (ref: string) => void }) {
  return (
    <div style={{ flexShrink: 0, padding: '4px 4px 0' }}>
      <Tabs
        items={win.tabs.map((ref) => ({ id: ref, label: tabLabel(win.kind, ref), closeLabel }))}
        selected={win.active}
        onSelect={onSelect}
        onClose={onClose}
        colors={TAB_COLORS.window}
        style={{ zoom: 'var(--ui-scale, 1)' }}
      />
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
          title={w.tabs.length > 1 && w.kind !== 'staffList' ? <b>{t(w.kind === 'device' ? 'ui.window.deviceProps' : 'ui.window.staffProps')}</b> : tabLabel(w.kind, w.active)}
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
