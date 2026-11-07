// 開いているウィンドウを描く。種類ごとに中身を選ぶ（機器の画面は DevicePanel、社員の札と一覧は StaffCard）。
// 機器・社員のウィンドウは、開いているタブをタイトルの帯の下に並べる（タブが1つのときは出さない）。タブが2つ以上あるときは、タイトルの帯に種類の名前（機器のプロパティ・社員のプロパティ）を出す。
// 幅 768 px 未満では、一番手前の1つだけを画面の下に出し、動かさない。
import { useEffect, useState, type ReactNode } from 'react';
import { t } from '../i18n/t';
import { frontWindow, clampRect, isNarrow, narrowRect, type Viewport, type WindowItem, type WindowKind, resizeRect } from '../ui/windows';
import { findDevice, DeviceBody, DeviceTitle } from './DevicePanel';
import { StaffBody, StaffListBody, StaffTitle } from './StaffCard';
import { Window } from './Window';
import { OfferBody } from './OfferCards';
import { OfficeBody } from './OfficePanel';
import { ShopBody } from './ShopCards';
import { InventoryBody } from './Inventory';
import { CompanyBody } from './CompanyPanel';
import { FundsBody } from './FundsPanel';
import { primaryButton } from './Modal';
import { Tabs, TAB_COLORS } from './Tabs';
import { TrimmedIcon } from './Icon';
import { useGameStore, viewportNow } from '../stores/useGameStore';
import { WINDOW_TAB_GAP, WINDOW_TAB_HEIGHT, uiScaled } from '../ui/theme';

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
  if (kind === 'offers') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <TrimmedIcon name="icon/mail" height={16} />
        <b style={{ whiteSpace: 'nowrap' }}>{t('ui.offer.title')}</b>
      </span>
    );
  }
  if (kind === 'shop') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <TrimmedIcon name="icon/cart" height={16} />
        <b style={{ whiteSpace: 'nowrap' }}>{t('ui.shop.title')}</b>
      </span>
    );
  }
  if (kind === 'inventory') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <TrimmedIcon name="icon/inventory" height={16} />
        <b style={{ whiteSpace: 'nowrap' }}>{t('ui.inventory.title')}</b>
      </span>
    );
  }
  if (kind === 'office') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <TrimmedIcon name='icon/furniture' height={16} />
        <b style={{ whiteSpace: 'nowrap' }}>{t('ui.office.title')}</b>
      </span>
    );
  }
  if (kind === 'funds') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <TrimmedIcon name="icon/money" height={16} />
        <b style={{ whiteSpace: 'nowrap' }}>{t('ui.funds.title')}</b>
      </span>
    );
  }
  if (kind === 'company') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <TrimmedIcon name="icon/level" height={16} />
        <b style={{ whiteSpace: 'nowrap' }}>{t('ui.company.title')}</b>
      </span>
    );
  }
  return <b style={{ whiteSpace: 'nowrap' }}>{t('ui.staff.list.title')}</b>;
};

// タブの帯。選ぶのはクリック、閉じるのは小さな×か中ボタンのクリック（Tabs が受け持つ）
function TabStrip({
  win,
  closeLabel,
  onSelect,
  onClose,
  onReorder,
}: {
  win: WindowItem;
  closeLabel: string;
  onSelect: (ref: string) => void;
  onClose: (ref: string) => void;
  onReorder: (from: number, to: number) => void;
}) {
  return (
    // 帯の高さは固定（タブの中身の大きさに関係なく、同じ高さ）。はみ出しは切る
    <div style={{ flexShrink: 0, boxSizing: 'border-box', height: uiScaled(WINDOW_TAB_GAP + WINDOW_TAB_HEIGHT), padding: `${uiScaled(WINDOW_TAB_GAP)} 4px 0`, overflow: 'hidden' }}>
      <Tabs
        items={win.tabs.map((ref) => ({ id: ref, label: tabLabel(win.kind, ref), closeLabel }))}
        selected={win.active}
        onSelect={onSelect}
        onClose={onClose}
        colors={TAB_COLORS.window}
        tabHeight={WINDOW_TAB_HEIGHT}
        // 開いて増えるタブは、ドラッグで並べ替えられる
        reorderable
        onReorder={onReorder}
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
      {/* スマホでパネルを開いている間は、後ろを暗くする。暗い所を押すとパネルを閉じる */}
      {narrow && front && (
        <div
          aria-hidden
          onClick={() => state.closeWindow(front.id)}
          style={{ position: 'absolute', inset: 0, zIndex: 4, background: 'rgba(10, 16, 32, 0.45)' }}
        />
      )}
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
                onReorder={(from, to) => state.reorderTab(w.id, from, to)}
              />
            ) : null
          }
          rect={narrow ? narrowRect(vp) : clampRect(w, vp)}
          movable={!narrow}
          // スマホもパソコンと同じく、右上の×で閉じる
          closeLabel={t('ui.panel.close')}
          onFocus={() => state.focusWindow(w.id)}
          onMove={(x, y) => state.moveWindow(w.id, x, y)}
          onResize={(edges, dx, dy, start) => state.placeWindow(w.id, resizeRect(start, edges, dx, dy, vp))}
          onClose={() => state.closeWindow(w.id)}
        >
          {w.kind === 'device' && <DeviceBody uid={w.active} />}
          {w.kind === 'staff' && <StaffBody uid={w.active} onTraining={onTraining} />}
          {w.kind === 'staffList' && <StaffListBody />}
          {w.kind === 'offers' && <OfferBody onClose={() => state.closeWindow(w.id)} />}
          {w.kind === 'shop' && <ShopBody />}
          {w.kind === 'inventory' && <InventoryBody />}
          {w.kind === 'company' && <CompanyBody />}
          {w.kind === 'funds' && <FundsBody />}
          {w.kind === 'office' && <OfficeBody />}
          {/* スマホでは、本文の下に閉じるボタンを置く（パソコンは窓の×で閉じる） */}
          {narrow && (
            <button style={{ ...primaryButton, display: 'block', marginTop: 8, marginLeft: 'auto' }} onClick={() => state.closeWindow(w.id)}>
              {t('ui.panel.close')}
            </button>
          )}
        </Window>
      ))}
    </>
  );
}
