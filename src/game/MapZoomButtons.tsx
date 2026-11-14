// マップの上の拡大・縮小ボタン（右下の角の内側、ツールバーの上）。キーの `+` `-` `0` と同じ命令を呼ぶ（mapControl.ts）
// ツールバーは高さ 56 px（ボタン 44 px と余白）。UIの大きさ（--ui-scale）の拡大を、この部品にも掛ける
import { useInventoryOpen } from '../ui/inventoryOpen';
import { t, tDyn } from '../i18n/t';
import { historyKeyOf } from '../sim/history';
import { focusedProject } from '../stores/useGameStore';
import { Icon } from '../components/Icon';
import { IconButton } from '../components/ui/IconButton';
import { usePhone } from '../ui/usePhone';
import { mapCommands } from './mapControl';
import { useGameStore } from '../stores/useGameStore';

// ツールバーの高さ（56 px）と、角からの余白（12 px）の分だけ上に置く
const TOOLBAR_HEIGHT_PX = 56;
const EDGE_PX = 12;
// 狭い画面（スマホ）では、ツールバーが1段の横スクロールになり、高さが変わる（余白とスクロールバーを含む）
const TOOLBAR_HEIGHT_PHONE_PX = 84;
// スマホでインベントリの欄を開いているときは、欄の上へ移す（欄は下から約 72 px の位置に出る。B6 の応急の対応。M2 で配置を決め直す）
const INVENTORY_RAISE_PHONE_PX = 80;

// スマホの戻す・やり直す。戻せない・やり直せないときは薄く出す。戻せなかった理由は列の左に出す
function PhoneHistoryButtons() {
  const undo = useGameStore((s) => s.undo);
  const redo = useGameStore((s) => s.redo);
  const canUndo = useGameStore((s) => (s.histories[historyKeyOf(focusedProject(s))]?.past.length ?? 0) > 0);
  const canRedo = useGameStore((s) => (s.histories[historyKeyOf(focusedProject(s))]?.future.length ?? 0) > 0);
  const historyError = useGameStore((s) => s.historyError);
  return (
    <>
      {historyError && (
        <span style={{ position: 'absolute', right: '100%', marginRight: 8, width: 180, fontSize: 13, color: '#ffd3c9', textAlign: 'right' }}>
          {tDyn(`ui.error.${historyError}`)}
        </span>
      )}
      <IconButton label={t('keys.undo')} disabled={!canUndo} onClick={() => undo()}>
        <Icon name="icon/undo" />
      </IconButton>
      <IconButton label={t('keys.redo')} disabled={!canRedo} layout={{ marginBottom: 12 }} onClick={() => redo()}>
        <Icon name="icon/redo" />
      </IconButton>
    </>
  );
}

export function MapZoomButtons() {
  const phone = usePhone();
  const inventoryOpen = useInventoryOpen();
  // スマホでウィンドウを開いているときは、下のシートと重なるので出さない（マップはドラッグで動かせる）
  const sheetOpen = useGameStore((s) => s.windows.length > 0);
  if (phone && sheetOpen) return null;
  return (
    <div
      style={{
        position: 'absolute',
        right: EDGE_PX,
        bottom: (phone ? TOOLBAR_HEIGHT_PHONE_PX + (inventoryOpen ? INVENTORY_RAISE_PHONE_PX : 0) : TOOLBAR_HEIGHT_PX) + EDGE_PX,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        zIndex: 5,
        zoom: 'var(--ui-scale, 1)',
      }}
    >
      {/* スマホでは、戻す・やり直すを拡大・縮小の上に置く（パソコンはツールバーにある） */}
      {phone && <PhoneHistoryButtons />}
      <IconButton label={t('keys.zoomIn')} onClick={() => mapCommands.zoomIn()}>
        {t('ui.map.zoomIn')}
      </IconButton>
      <IconButton label={t('keys.zoomOut')} onClick={() => mapCommands.zoomOut()}>
        {t('ui.map.zoomOut')}
      </IconButton>
      <IconButton label={t('keys.zoomReset')} onClick={() => mapCommands.fit()}>
        <Icon name="icon/fit" scale={2} />
      </IconButton>
    </div>
  );
}
