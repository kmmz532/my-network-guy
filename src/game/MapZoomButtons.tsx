// マップの上の拡大・縮小ボタン（右下の角の内側、ツールバーの上）。キーの `+` `-` `0` と同じ命令を呼ぶ（mapControl.ts）
// ツールバーは高さ 56 px（ボタン 44 px と余白）。UIの大きさ（--ui-scale）の拡大を、この部品にも掛ける
import { t } from '../i18n/t';
import { RADIUS } from '../ui/theme';
import { Icon } from '../components/Icon';
import { usePhone } from '../ui/usePhone';
import { mapCommands } from './mapControl';
import { useGameStore } from '../stores/useGameStore';

// ツールバーの道具のボタンと同じ見た目
const buttonStyle = {
  width: 44,
  height: 44,
  padding: 2,
  border: '2px solid #3b2a33',
  background: '#25406f',
  borderRadius: RADIUS.chrome,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#f4f1e6',
  fontSize: 18,
} as const;

// ツールバーの高さ（56 px）と、角からの余白（12 px）の分だけ上に置く
const TOOLBAR_HEIGHT_PX = 56;
const EDGE_PX = 12;
// 狭い画面（スマホ）では、ツールバーが1段の横スクロールになり、高さが変わる（余白とスクロールバーを含む）
const TOOLBAR_HEIGHT_PHONE_PX = 84;

export function MapZoomButtons() {
  const phone = usePhone();
  // スマホでウィンドウを開いているときは、下のシートと重なるので出さない（マップはドラッグで動かせる）
  const sheetOpen = useGameStore((s) => s.windows.length > 0);
  if (phone && sheetOpen) return null;
  return (
    <div
      style={{
        position: 'absolute',
        right: EDGE_PX,
        bottom: (phone ? TOOLBAR_HEIGHT_PHONE_PX : TOOLBAR_HEIGHT_PX) + EDGE_PX,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        zIndex: 5,
        zoom: 'var(--ui-scale, 1)',
      }}
    >
      <button type="button" style={buttonStyle} onClick={() => mapCommands.zoomIn()} aria-label={t('keys.zoomIn')}>
        {t('ui.map.zoomIn')}
      </button>
      <button type="button" style={buttonStyle} onClick={() => mapCommands.zoomOut()} aria-label={t('keys.zoomOut')}>
        {t('ui.map.zoomOut')}
      </button>
      <button type="button" style={buttonStyle} onClick={() => mapCommands.fit()} aria-label={t('keys.zoomReset')}>
        <Icon name="icon/fit" scale={2} />
      </button>
    </div>
  );
}
