// ゲームの場面。マップの上に、HUD・ウィンドウ・ポップアップ・知らせを重ねる。
// 毎ティック変わる時計は購読しない（時計を使う部品が、それぞれ必要な値だけ購読する）。
import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DEBUG_ENABLED } from '../../debug';
import { t } from '../../i18n/t';
import { PixiStage } from '../../game/PixiStage';
import { useKeymap } from '../../input/useKeymap';
import { saveSession, useSaveSession } from '../../services/saveSession';
import { loadSettings } from '../../settings/settings';
import { useGameStore } from '../../stores/useGameStore';
import { useTickLoop } from '../../stores/useTickLoop';
import { usePhone } from '../../ui/usePhone';
import { FocusSwitch } from '../FocusSwitch';
import { Guide } from '../Guide';
import Header from '../Header';
import { HiringPanel } from '../HiringPanel';
import { Modal, primaryButton } from '../Modal';
import { ReportModal } from '../Overlay';
import { PausedBuildPrompt } from '../PausedBuildPrompt';
import { PortMenu } from '../PortMenu';
import { TabConflict } from '../TabConflict';
import { TaskPanel } from '../TaskPanel';
import { Toolbar } from '../Toolbar';
import { TooltipHost } from '../Tooltip';
import { UpdateNotice } from '../UpdateNotice';
import { Windows } from '../Windows';
import { GamePopups } from './GamePopups';
import { TopNotices } from './TopNotices';

// デバッグのパネルは ?debug=1 のときだけ読み込む（N54）
const DebugPanel = lazy(() => import('../DebugPanel'));

// 倒産の画面。やり直すと、タイトルで新しく始める流れを開く
function GameOver({ onRetry }: { onRetry: () => void }) {
  const bankrupt = useGameStore((s) => s.clock.bankrupt);
  if (!bankrupt) return null;
  return (
    <Modal
      primary={onRetry}
      backStyle={{ background: 'rgba(20, 20, 30, 0.8)', flexDirection: 'column', gap: 12, color: '#f4f1e6' }}
      boxStyle={{ background: 'none', border: 'none', padding: 0, maxWidth: 'none', alignItems: 'center', display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <h2 style={{ fontSize: 28, margin: 0 }}>{t('ui.gameover.title')}</h2>
      <button style={{ ...primaryButton, padding: '10px 24px', fontSize: 16 }} onClick={onRetry}>
        {t('ui.gameover.retry')}
      </button>
    </Modal>
  );
}

// onExit はタイトルへ戻る。opening を渡すと、戻った先で新しく始める流れを開く
export function GameScene({ onExit }: { onExit: (opening?: 'newCareer') => void }) {
  const phone = usePhone();
  // 今遊んでいる会社の枠。同じ枠の別のタブを見つけるために使う（N133）
  const activeSlot = useSaveSession((s) => s.slot);
  const pausedPrompt = useGameStore((s) => s.pausedPrompt);

  // ヘッダーの下端（画面の座標）。狭い画面では案件の札と速さの表示を、ヘッダーの下に置く
  const headerRef = useRef<HTMLElement>(null);
  const [hudBottom, setHudBottom] = useState(0);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHudBottom(el.getBoundingClientRect().bottom);
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  // 上の列の上端。狭い画面ではヘッダーの下に置く（ヘッダーの高さは zoom を掛けた画面の座標なので、倍率で割って渡す）
  const hudTop = phone ? (hudBottom + 6) / loadSettings().uiScale : 44;

  useTickLoop();
  // キーの表は、ゲームの場面にいる間だけ効く
  useKeymap();
  // ゲームの場面にいる間、自動保存の契機を見張る
  useEffect(() => saveSession.watch(), []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <TabConflict slot={activeSlot} />
      <PixiStage />
      <Header headerRef={headerRef} />
      {/* 左上の列: 切り替えのボタンと案件の欄を縦に並べる（位置の数値を部品に持たせない・N121） */}
      <div style={{ position: 'absolute', top: hudTop, left: 8, zIndex: 5, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
        <FocusSwitch />
        <TaskPanel />
      </div>
      <Windows />
      <PortMenu />
      <Toolbar />
      <Guide />
      {DEBUG_ENABLED && (
        <Suspense fallback={null}>
          <DebugPanel />
        </Suspense>
      )}
      <HiringPanel />
      <TooltipHost />
      <GamePopups onExit={() => onExit()} />
      <TopNotices top={hudTop} />
      <UpdateNotice />
      {pausedPrompt && <PausedBuildPrompt />}
      <ReportModal />
      <GameOver onRetry={() => onExit('newCareer')} />
    </div>
  );
}
