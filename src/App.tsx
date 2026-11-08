import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DEBUG_ENABLED } from './debug';
import { usePhone } from './ui/usePhone';
import { balance } from 'virtual:game-data';
import { loadLang, t } from './i18n/t';
import { PixiStage } from './game/PixiStage';
import { useGameStore, type Speed } from './stores/useGameStore';
import { useTickLoop } from './stores/useTickLoop';
import { moveLegacySlots } from './services/db';
import { saveSession, useSaveSession } from './services/saveSession';
import { NoticeToast, ReportModal } from './components/Overlay';
import { FocusSwitch } from './components/FocusSwitch';
import { dangerButton, Modal, primaryButton, secondaryButton } from './components/Modal';
import { KeyHelp } from './components/KeyHelp';
import { SettingsPanel } from './components/SettingsPanel';
import { SandboxSizePanel } from './components/SandboxSizePanel';
import { useKeymap } from './input/useKeymap';
import { applyUiScale, loadSettings } from './settings/settings';
import { Toolbar } from './components/Toolbar';
import { Guide } from './components/Guide';
import { TaskPanel } from './components/TaskPanel';
import { Windows } from './components/Windows';
import { PortMenu } from './components/PortMenu';
import { HiringPanel } from './components/HiringPanel';
import { useUiStore } from './stores/useUiStore';
import { TooltipHost } from './components/Tooltip';
import { PausedBuildPrompt } from './components/PausedBuildPrompt';
import { LoopBanner } from './components/LoopBanner';
import { TabConflict } from './components/TabConflict';
import { UpdateNotice } from './components/UpdateNotice';
import { TitleScene } from './components/scene/TitleScene';
import { mapLoaders } from 'virtual:loaders';
import { RADIUS } from './ui/theme';
import { levelOf } from './sim/level';
import { isSpeedUnlocked } from './sim/speed';
import Header from './components/Header';

// 速さを変えたときに画面上部に出す表示は、この時間で消す
const SPEED_NOTE_MS = 1000;

type Screen = 'title' | 'game';

// デバッグのパネルは ?debug=1 のときだけ読み込む（N54）
const DebugPanel = lazy(() => import('./components/DebugPanel'));

export function App() {
  const [ready, setReady] = useState(false);
  // 翻訳や地図の読み込みが失敗したときの例外（エラー画面で再読み込みを促す。B9）
  const [loadError, setLoadError] = useState<unknown>(null);
  const [screen, setScreen] = useState<Screen>('title');
  const [titleOpening, setTitleOpening] = useState<'newCareer' | undefined>(undefined);
  const popup = useUiStore((s) => s.popup);
  const setPopup = useUiStore.getState().setPopup;
  const [message, setMessage] = useState('');
  const clock = useGameStore((s) => s.clock);
  const speed = useGameStore((s) => s.speed);
  const setSpeed = useGameStore((s) => s.setSpeed);
  const pausedPrompt = useGameStore((s) => s.pausedPrompt);
  // 速さを変えたときの短い表示（1秒で消す）
  const [speedNote, setSpeedNote] = useState<{ speed: Speed; id: number } | null>(null);
  const lastSpeed = useRef(speed);
  // 今遊んでいる会社の枠（経営もサンドボックスも、その会社の枠へ保存する・N133）。同じ枠の別のタブを見つけるためにも使う
  const activeSlot = useSaveSession((s) => s.slot);
  const saveFailed = useSaveSession((s) => s.failed);
  const resizeSandbox = useGameStore((s) => s.resizeSandbox);
  // サンドボックスの画面。速度のボタン・社員・依頼は出さない
  const sandbox = useGameStore((s) => s.mode) === 'sandbox';
  const office = useGameStore((s) => s.office);
  const cacheMap = useGameStore((s) => s.cacheMap);
  // ヘッダーの下端（画面の座標）。狭い画面では案件の札と速さの表示を、ヘッダーの下に置く
  const headerRef = useRef<HTMLElement>(null);
  const [hudBottom, setHudBottom] = useState(0);
  const phone = usePhone();
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
  }, [ready, screen]);

  useTickLoop();
  useEffect(() => {
    if (lastSpeed.current === speed) return;
    lastSpeed.current = speed;
    const id = Date.now();
    setSpeedNote({ speed, id });
    const timer = window.setTimeout(() => setSpeedNote((n) => (n?.id === id ? null : n)), SPEED_NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [speed]);
  // キーの表は、ゲームの画面が開いている間だけ効く。M・S・? はポップアップを、E はインベントリを開け閉めする
  useKeymap(screen === 'game');

  useEffect(() => {
    // タイトル画面の間は時間を止める。端末の UI の大きさを反映する
    setSpeed(0);
    applyUiScale(loadSettings().uiScale);
    // 翻訳と、すべての地図を起動時に読み込んでから始める。依頼の判定は地図の読み込みに依存するため、読み込み中に判定させない
    const maps = Object.values(mapLoaders).map((load) => load().then((m) => cacheMap(m.default)));
    Promise.all([loadLang('ja_jp'), ...maps, moveLegacySlots()]).then(() => setReady(true), (e: unknown) => setLoadError(e ?? new Error('読み込みに失敗')));
  }, []);

  // 自動保存に失敗したときは知らせる（黙って続けない・N133）
  useEffect(() => {
    if (!saveFailed) return;
    setMessage(t('ui.save.failed'));
    saveSession.acknowledgeFailure();
  }, [saveFailed]);

  // ゲームの画面にいる間、自動保存の契機を見張る
  useEffect(() => (screen === 'game' ? saveSession.watch() : undefined), [screen]);

  if (loadError) throw loadError;
  if (!ready) return null;

  // ゲームの場面へ移る（タイトルで会社を決めたあと）
  const enterGame = () => {
    setMessage('');
    // 保存を、ブラウザが勝手に消さないように頼む（断られても遊べる・N133）
    void navigator.storage?.persist?.();
    // 時間を進める初期の速さは設定で決める
    // 解放されていない速さは、1倍にする（4倍は会社のレベル3で解放される・N99）
    const wanted = loadSettings().startSpeed;
    setSpeed(isSpeedUnlocked(wanted, levelOf(useGameStore.getState().companyExp, balance), balance) ? (wanted as Speed) : 1);
    setTitleOpening(undefined);
    setScreen('game');
  };

  // タイトルへ戻る。倒産の「やり直す」は、新しく始める流れを開いて戻る
  const toTitle = (opening?: 'newCareer') => {
    setPopup(null);
    setSpeed(0);
    saveSession.open(null);
    setTitleOpening(opening);
    setScreen('title');
  };

  if (screen === 'title') return <TitleScene onEnter={enterGame} opening={titleOpening} />;

  const onSave = async () => {
    // 倒産した後は保存しない（倒産の前の保存を上書きしない）
    if (await saveSession.save()) setMessage(t('ui.save.done'));
  };

  const onExport = () => {
    const text = saveSession.exportText();
    if (text === null) return;
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'my-network-guy-save.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onImport = async (file: File) => {
    try {
      saveSession.importText(await file.text());
      setMessage(t('ui.import.done'));
    } catch (e) {
      setMessage(t('ui.import.failed', { reason: (e as Error).message }));
    }
  };

  // メニューの項目。ボタンとファイルを選ぶラベルで、文字の大きさと見た目をそろえる
  const menuButton = { ...secondaryButton, display: 'block', width: '100%', margin: '4px 0', padding: '6px 12px', fontSize: 13, lineHeight: 1.4, boxSizing: 'border-box' } as const;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <TabConflict slot={activeSlot} />
      <PixiStage />
      <Header headerRef={headerRef} />
      {/* 左上の列: 切り替えのボタンと案件の欄を縦に並べる（位置の数値を部品に持たせない・N121）。狭い画面では、列をヘッダーの下に置く（ヘッダーの高さは zoom を掛けた画面の座標なので、上端は倍率で割って渡す） */}
      <div style={{ position: 'absolute', top: phone ? (hudBottom + 6) / loadSettings().uiScale : 44, left: 8, zIndex: 5, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
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
      {popup === 'menu' && (
        <Modal onClose={() => setPopup(null)} boxStyle={{ minWidth: 200 }}>
          <button style={menuButton} onClick={onSave}>{t('ui.save')}</button>
          <button style={menuButton} onClick={onExport}>{t('ui.export')}</button>
          <label style={{ ...menuButton, textAlign: 'center' }}>
            {t('ui.import')}
            <input
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])}
            />
          </label>
          <button style={menuButton} onClick={() => setPopup('settings')}>
            {t('ui.menu.settings')}
          </button>
          <button
            style={menuButton}
            onClick={() => toTitle()}
          >
            {t('ui.title.back')}
          </button>
          {sandbox && (
            <>
              <button style={menuButton} onClick={() => setPopup('sandboxResize')}>
                {t('ui.sandbox.size.change')}
              </button>
              <button style={menuButton} onClick={() => setPopup('sandboxResetConfirm')}>
                {t('ui.sandbox.size.reset')}
              </button>
            </>
          )}
          {message && <div style={{ marginTop: 6, fontSize: 13 }}>{message}</div>}
        </Modal>
      )}
      {popup === 'sandboxResize' && (
        <SandboxSizePanel
          title={t('ui.sandbox.size.change')}
          start={t('ui.sandbox.size.apply')}
          current={office.size}
          onClose={() => setPopup(null)}
          submit={(size) => {
            const reason = resizeSandbox(size);
            return reason === null ? null : t('ui.sandbox.size.blocked');
          }}
        />
      )}
      {popup === 'sandboxResetConfirm' && (
        // Enter で作り直しの広さを選ぶ画面へ進み、Esc で取り消す
        <Modal
          onClose={() => setPopup(null)}
          primary={() => setPopup('sandboxReset')}
          boxStyle={{ minWidth: 240 }}
        >
          <div style={{ fontWeight: 'bold', marginBottom: 12 }}>{t('ui.sandbox.size.resetConfirm')}</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              style={{ padding: '4px 12px', cursor: 'pointer', background: 'transparent', color: '#f4f1e6', border: '1px solid #f4f1e6', borderRadius: RADIUS.none }}
              onClick={() => setPopup(null)}
            >
              {t('ui.sandbox.size.cancel')}
            </button>
            <button style={dangerButton} onClick={() => setPopup('sandboxReset')}>
              {t('ui.sandbox.size.recreate')}
            </button>
          </div>
        </Modal>
      )}
      {popup === 'sandboxReset' && (
        <SandboxSizePanel
          title={t('ui.sandbox.size.reset')}
          start={t('ui.sandbox.size.start')}
          onClose={() => setPopup(null)}
          submit={(size) => {
            useGameStore.getState().newSandbox(size);
            return null;
          }}
        />
      )}
      {popup === 'help' && <KeyHelp onClose={() => setPopup(null)} />}
      {popup === 'settings' && <SettingsPanel onClose={() => setPopup(null)} onOpenKeys={() => setPopup('help')} />}
      {/* 上の中央の知らせ（通知・繰り返しの案内・速度の表示）は、1つの縦並びの箱に入れる。位置の数値は箱だけが持つ（N124） */}
      <div style={{ position: 'absolute', top: phone ? (hudBottom + 6) / loadSettings().uiScale : 44, left: '50%', transform: 'translateX(-50%)', zIndex: 9, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, zoom: 'var(--ui-scale, 1)' }}>
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
      <UpdateNotice />
      {pausedPrompt && <PausedBuildPrompt />}
      <ReportModal />
      {clock.bankrupt && (
        <Modal
          primary={() => toTitle('newCareer')}
          backStyle={{ background: 'rgba(20, 20, 30, 0.8)', flexDirection: 'column', gap: 12, color: '#f4f1e6' }}
          boxStyle={{ background: 'none', border: 'none', padding: 0, maxWidth: 'none', alignItems: 'center', display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <h2 style={{ fontSize: 28, margin: 0 }}>{t('ui.gameover.title')}</h2>
          <button style={{ ...primaryButton, padding: '10px 24px', fontSize: 16 }} onClick={() => toTitle('newCareer')}>
            {t('ui.gameover.retry')}
          </button>
        </Modal>
      )}
    </div>
  );
}
