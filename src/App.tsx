import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DEBUG_ENABLED } from './debug';
import { isPhoneNow, usePhone } from './ui/usePhone';
import { balance } from 'virtual:game-data';
import { loadLang, t } from './i18n/t';
import { PixiStage } from './game/PixiStage';
import { useGameStore, type Speed } from './stores/useGameStore';
import { useTickLoop } from './stores/useTickLoop';
import { toDate } from './sim/clock';
import { deleteSlot, listCompanies, moveLegacySlots, saveSlot } from './services/db';
import { CompanyScreen, type CompanyView } from './components/CompanyScreen';
import { copyNameOf, freeSlotOf, isNameTaken, isValidCompanyName, latestCompany, suggestCompanyName, uniqueNameFrom, type CompanySave } from './services/companies';
import type { GameMode, SaveData } from './services/migrations';
import { createSaveQueue, isAutoSaveDue } from './services/autoSave';
import { exportSave, importSave } from './services/saveFile';
import { NoticeToast, ReportModal } from './components/Overlay';
import { FocusSwitch } from './components/FocusSwitch';
import { dangerButton, Modal, primaryButton, secondaryButton } from './components/Modal';
import { KeyHelp } from './components/KeyHelp';
import { SettingsPanel } from './components/SettingsPanel';
import { SandboxSizePanel } from './components/SandboxSizePanel';
import { useKeymap } from './input/useKeymap';
import { tipText } from './input/keymap';
import { applyUiScale, loadSettings } from './settings/settings';
import { Toolbar } from './components/Toolbar';
import { Guide } from './components/Guide';
import { TaskPanel } from './components/TaskPanel';
import { Windows } from './components/Windows';
import { PortMenu } from './components/PortMenu';
import { HiringPanel, type HiringTab } from './components/HiringPanel';
import { Tooltip, TooltipHost, hideTip } from './components/Tooltip';
import { PausedBuildPrompt } from './components/PausedBuildPrompt';
import { LoopBanner } from './components/LoopBanner';
import { TabConflict } from './components/TabConflict';
import { UpdateNotice } from './components/UpdateNotice';
import { Icon } from './components/Icon';
import { TitleScreen } from './components/TitleScreen';
import { mapLoaders } from 'virtual:loaders';
import { RADIUS } from './ui/theme';
import { levelOf } from './sim/level';
import { isSpeedUnlocked, nextFastSpeed, unlockedSpeedsOf } from './sim/speed';
import { ExpGauge, LevelMark } from './components/CompanyPanel';

// 速さのボタン: 停止・1倍のあとに、早送り（2倍・4倍・8倍。解放済みを押すたびに切り替える・N99）
const SPEEDS: Speed[] = [0, 1];
// 速さを変えたときに画面上部に出す表示は、この時間で消す
const SPEED_NOTE_MS = 1000;
// 自動保存の印（ヘッダーの小さなアイコン）は、この時間で消す
const SAVE_MARK_MS = 1000;

type Screen = 'title' | 'game';
type Popup = 'menu' | 'help' | 'settings' | 'sandboxResize' | 'sandboxReset' | 'sandboxResetConfirm' | null;

// 上部の操作（速さ・メニュー・社員）の大きさ。指で押すため、スマホでも 44 px の高さを確保する（M4）
// 上部の操作の見た目。パソコンは文字の幅に合わせた横長で低いボタン。スマホは指で押すため 44 px 以上にする（M4・B11）
const hudButton = (on: boolean, phone: boolean) =>
  ({
    padding: '2px 8px',
    ...(phone ? { minHeight: 30, minWidth: 40 } : {}),
    cursor: 'pointer',
    background: on ? '#ffd866' : '#25406f',
    color: on ? '#3b2a33' : '#f4f1e6',
    border: '1px solid #3b2a33',
    borderRadius: RADIUS.chrome,
  }) as const;

// デバッグのパネルは ?debug=1 のときだけ読み込む（N54）
const DebugPanel = lazy(() => import('./components/DebugPanel'));

export function App() {
  const [ready, setReady] = useState(false);
  // 翻訳や地図の読み込みが失敗したときの例外（エラー画面で再読み込みを促す。B9）
  const [loadError, setLoadError] = useState<unknown>(null);
  const [screen, setScreen] = useState<Screen>('title');
  const [popup, setPopup] = useState<Popup>(null);
  const [message, setMessage] = useState('');
  // タイトルから新しく始めるサンドボックスの広さを選ぶ画面
  const [sandboxPick, setSandboxPick] = useState(false);
  const clock = useGameStore((s) => s.clock);
  const companyExp = useGameStore((s) => s.companyExp);
  const levelNow = levelOf(companyExp, balance);
  const speed = useGameStore((s) => s.speed);
  const setSpeed = useGameStore((s) => s.setSpeed);
  // 勤務時間外に自動で早送りしている間の、元の速さ（「夜は早送り」と出す）
  const nightSpeed = useGameStore((s) => s.nightSpeed);
  const pausedPrompt = useGameStore((s) => s.pausedPrompt);
  // 速さを変えたときの短い表示（1秒で消す）
  const [speedNote, setSpeedNote] = useState<{ speed: Speed; id: number } | null>(null);
  const lastSpeed = useRef(speed);
  // 自動保存の印を出している間だけ値を持つ（自動保存が終わった時刻）
  const [saveMark, setSaveMark] = useState<number | null>(null);
  // 今遊んでいる会社の枠（経営もサンドボックスも、その会社の枠へ保存する・N133）
  const slotRef = useRef<number | null>(null);
  // 同じ枠（会社）の別のタブを見つけるための、今開いている枠（画面の表示にも使う・N133）
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  // 会社（セーブの枠）の画面。タイトル画面の上に出す（N132・N133）
  const [companyView, setCompanyView] = useState<CompanyView | null>(null);
  const [companyMode, setCompanyMode] = useState<GameMode>('career');
  const [companies, setCompanies] = useState<CompanySave[]>([]);
  const [companyNotice, setCompanyNotice] = useState('');
  // 枠が全部埋まっているときに読み込んだ会社（上書きする枠を選んでから入れる）
  const [pendingImport, setPendingImport] = useState<SaveData | null>(null);
  // 自動保存の直列化。実行中に次の要求が来たら、終わってから1回だけ書く（書く内容は実行時点の状態）
  const [autoSaver] = useState(() =>
    createSaveQueue(async () => {
      // 倒産した後の状態は保存しない（倒産の前の保存を残し、読み込みで倒産の前からやり直せるようにする）
      if (useGameStore.getState().clock.bankrupt) return;
      try {
        const data = useGameStore.getState().snapshot();
        // 今遊んでいる会社の枠に保存する（会社ごとの枠なので、ほかの会社を壊さない）
        if (slotRef.current !== null) await saveSlot(slotRef.current, data);
        setSaveMark(Date.now());
      } catch {
        // 保存できなかったときは印を出さない。保存の失敗は知らせる（黙って続けない・N133）
        setMessage(t('ui.save.failed'));
      }
    }),
  );
  const load = useGameStore((s) => s.load);
  const snapshot = useGameStore((s) => s.snapshot);
  const newGame = useGameStore((s) => s.newGame);
  const renameCompany = useGameStore((s) => s.renameCompany);
  const newSandbox = useGameStore((s) => s.newSandbox);
  const resizeSandbox = useGameStore((s) => s.resizeSandbox);
  // サンドボックスの画面。速度のボタン・社員・依頼は出さない
  const sandbox = useGameStore((s) => s.mode) === 'sandbox';
  const office = useGameStore((s) => s.office);
  // 社員の人数。雇えなかった理由をHUDに出す
  const [hiring, setHiring] = useState(false);
  const [hiringTab, setHiringTab] = useState<HiringTab>('hiring');
  // 通知の「採用」から開く要求（N96）
  const hiringRequest = useGameStore((s) => s.hiringRequest);
  useEffect(() => {
    if (hiringRequest === 0) return;
    setHiringTab('hiring');
    setHiring(true);
  }, [hiringRequest]);
  const openWindow = useGameStore((s) => s.openWindow);
  const cacheMap = useGameStore((s) => s.cacheMap);
  // インベントリの開け閉め（ツールバーと E キーで使う）。スマホは帯（この状態）、パソコンはウィンドウ（ウィンドウの一覧）で持つ
  const [inventoryStripOpen, setInventoryStripOpen] = useState(false);
  const inventoryWindowOpen = useGameStore((s) => s.windows.some((w) => w.kind === 'inventory'));
  // ヘッダーの下端（画面の座標）。狭い画面では案件の札と速さの表示を、ヘッダーの下に置く
  const headerRef = useRef<HTMLElement>(null);
  const [hudBottom, setHudBottom] = useState(0);
  const phone = usePhone();
  const inventoryOpen = phone ? inventoryStripOpen : inventoryWindowOpen;
  const setInventoryOpen = (open: boolean) => {
    if (isPhoneNow()) setInventoryStripOpen(open);
    else if (open !== useGameStore.getState().windows.some((w) => w.kind === 'inventory')) useGameStore.getState().toggleWindow('inventory', '');
  };
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
  useKeymap(screen === 'game', {
    // 依頼とショップは、マップの操作を止めないウィンドウで開く（N40）
    togglePopup: (name) => {
      if (name === 'offers' || name === 'shop') useGameStore.getState().toggleWindow(name, '');
      else setPopup((p) => (p === name ? null : name));
    },
    toggleInventory: () => {
      if (isPhoneNow()) setInventoryStripOpen((v) => !v);
      else useGameStore.getState().toggleWindow('inventory', '');
    },
  });

  useEffect(() => {
    // タイトル画面の間は時間を止める。端末の UI の大きさを反映する
    setSpeed(0);
    applyUiScale(loadSettings().uiScale);
    // 翻訳と、すべての地図を起動時に読み込んでから始める。依頼の判定は地図の読み込みに依存するため、読み込み中に判定させない
    const maps = Object.values(mapLoaders).map((load) => load().then((m) => cacheMap(m.default)));
    Promise.all([loadLang('ja_jp'), ...maps, moveLegacySlots()]).then(() => setReady(true), (e: unknown) => setLoadError(e ?? new Error('読み込みに失敗')));
  }, []);

  useEffect(() => {
    if (!saveMark) return;
    const timer = window.setTimeout(() => setSaveMark(null), SAVE_MARK_MS);
    return () => window.clearTimeout(timer);
  }, [saveMark]);

  // 設定が「しない」のときは保存しない。保存の判定は、その時点の設定で行う
  const autoSaveNow = () => {
    if (loadSettings().autoSave !== 'off') void autoSaver();
  };

  // 設定の間隔で、ゲーム内の朝0時を越えたら保存する（時間が戻った読み込みでは保存しない）
  const lastMinute = useRef(clock.minute);
  useEffect(() => {
    const prev = lastMinute.current;
    lastMinute.current = clock.minute;
    if (screen === 'game' && isAutoSaveDue(loadSettings().autoSave, prev, clock.minute)) autoSaveNow();
  }, [clock.minute]);

  // 案件を納品したとき（検収に通った報告が届いたとき）に保存する
  const lastReport = useGameStore((s) => s.lastReport);
  useEffect(() => {
    if (screen === 'game' && lastReport?.passed) autoSaveNow();
  }, [lastReport]);

  // ページを隠すとき・閉じるときに保存する
  useEffect(() => {
    if (screen !== 'game') return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') autoSaveNow();
    };
    const onPageHide = () => autoSaveNow();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [screen]);

  if (loadError) throw loadError;
  if (!ready) return null;

  const startGame = () => {
    setMessage('');
    // 保存を、ブラウザが勝手に消さないように頼む（断られても遊べる・N133）
    void navigator.storage?.persist?.();
    // 時間を進める初期の速さは設定で決める
    // 解放されていない速さは、1倍にする（4倍は会社のレベル3で解放される・N99）
    const wanted = loadSettings().startSpeed;
    setSpeed(isSpeedUnlocked(wanted, levelOf(useGameStore.getState().companyExp, balance), balance) ? (wanted as Speed) : 1);
    setScreen('game');
  };

  // 会社の一覧を、遊び方ごとに読み直す
  const refreshCompanies = async (mode: GameMode): Promise<CompanySave[]> => {
    const list = await listCompanies(mode);
    setCompanies(list);
    return list;
  };
  const openCompanies = async (mode: GameMode, purpose: 'play' | 'overwrite') => {
    setCompanyMode(mode);
    setCompanyNotice('');
    await refreshCompanies(mode);
    setCompanyView({ kind: 'list', purpose });
  };

  // 会社を開いて遊ぶ（その会社の枠に保存し続ける）
  const playSave = (save: CompanySave) => {
    load(save.data);
    slotRef.current = save.slot;
    setActiveSlot(save.slot);
    setCompanyView(null);
    startGame();
  };

  // 新しく始める（経営）。空いた枠があれば社名を決めて始める。全部埋まっていれば、上書きする会社を選ばせる（N132）
  const onNew = async () => {
    setCompanyMode('career');
    setCompanyNotice('');
    const list = await refreshCompanies('career');
    const free = freeSlotOf('career', list);
    if (free !== null) setCompanyView({ kind: 'name', slot: free, suggested: suggestCompanyName('career', list), from: 'new' });
    else setCompanyView({ kind: 'list', purpose: 'overwrite' });
  };

  // 「続きから」は、最後に保存した経営の会社を開く
  const onContinue = async () => {
    const latest = latestCompany(await listCompanies('career'));
    if (!latest) return setMessage(t('ui.title.none'));
    playSave(latest);
  };

  const onCompanies = () => {
    void openCompanies('career', 'play');
  };

  // サンドボックスは、保存があれば一覧を開き（「新しく作る」も一覧に置く）、なければ広さを選んで始める
  const onSandbox = async () => {
    setCompanyMode('sandbox');
    const list = await refreshCompanies('sandbox');
    if (list.length > 0) setCompanyView({ kind: 'list', purpose: 'play' });
    else setSandboxPick(true);
  };

  // 広さを決めたサンドボックスは、社名を決めてから始める
  const onSandboxSized = async () => {
    setCompanyMode('sandbox');
    const list = await refreshCompanies('sandbox');
    const free = freeSlotOf('sandbox', list);
    if (free === null) {
      setCompanyView({ kind: 'list', purpose: 'overwrite' });
      return;
    }
    setCompanyView({ kind: 'name', slot: free, suggested: suggestCompanyName('sandbox', list), from: 'new' });
  };

  // 一覧の「新しく作る」: 経営は社名、サンドボックスは広さを選ぶ
  const onNewHere = () => {
    setCompanyView(null);
    if (companyMode === 'sandbox') setSandboxPick(true);
    else void onNew();
  };

  // 社名を決めて始める。経営は新しい会社、サンドボックスは広さを決めた今の状態に社名を付ける
  const startIn = async (slot: number, name: string) => {
    const trimmed = name.trim();
    if (companyMode === 'career') newGame(trimmed);
    else renameCompany(trimmed);
    slotRef.current = slot;
    setActiveSlot(slot);
    await saveSlot(slot, snapshot());
    setCompanyView(null);
    startGame();
  };

  // 社名を変える（同じ遊び方の中で、同じ名前は不可）
  const renameSave = async (save: CompanySave, name: string) => {
    const trimmed = name.trim();
    if (!isValidCompanyName(trimmed)) return setCompanyNotice(t('ui.company.name.hint', { max: 12 }));
    const list = await refreshCompanies(companyMode);
    if (isNameTaken(trimmed, list.filter((s) => s.slot !== save.slot))) return setCompanyNotice(t('ui.company.name.taken'));
    await saveSlot(save.slot, { ...save.data, name: trimmed });
    await refreshCompanies(companyMode);
    setCompanyNotice('');
    setCompanyView({ kind: 'list', purpose: 'play' });
  };

  // 複製する（空いた枠に同じ会社を写し、社名に「（コピー）」を付ける）
  const copySave = async (save: CompanySave) => {
    const list = await refreshCompanies(companyMode);
    const free = freeSlotOf(companyMode, list);
    if (free === null) return setCompanyNotice(t('ui.company.copy.full'));
    await saveSlot(free, { ...save.data, name: copyNameOf(save.data.name, list) });
    await refreshCompanies(companyMode);
    setCompanyNotice('');
  };

  // 書き出す（その会社1つをファイルに保存する）
  const exportCompany = (save: CompanySave) => {
    const blob = new Blob([exportSave(save.data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${save.data.name}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // 消す（元に戻せない）。今遊んでいる会社は、ここ（タイトル画面）からしか消せない
  const removeSave = async (save: CompanySave) => {
    await deleteSlot(save.slot);
    await refreshCompanies(companyMode);
    setCompanyNotice('');
    setCompanyView({ kind: 'list', purpose: 'play' });
  };

  // 読み込んだ会社を、選んだ会社の枠に入れる（上書きの確認のあと。N133）
  const overwriteWithPending = async (save: CompanySave) => {
    if (pendingImport === null) return;
    const list = await refreshCompanies(companyMode);
    await saveSlot(save.slot, { ...pendingImport, name: uniqueNameFrom(pendingImport.name, list.filter((s) => s.slot !== save.slot)) });
    setPendingImport(null);
    await refreshCompanies(companyMode);
    setCompanyNotice('');
    setCompanyView({ kind: 'list', purpose: 'play' });
  };

  // ファイルから読み込む。同じ遊び方の会社だけ。空いた枠に入れ、同じ社名があれば番号を付ける
  const importCompany = async (file: File) => {
    try {
      const data = importSave(await file.text());
      if (data.mode !== companyMode) return setCompanyNotice(t('ui.company.import.mode'));
      const list = await refreshCompanies(companyMode);
      const free = freeSlotOf(companyMode, list);
      // 空きがなければ、上書きする会社を選ばせる（上書きの確認は N132 と同じ）
      if (free === null) {
        setPendingImport(data);
        setCompanyNotice(t('ui.company.import.full'));
        setCompanyView({ kind: 'list', purpose: 'overwrite' });
        return;
      }
      await saveSlot(free, { ...data, name: uniqueNameFrom(data.name, list) });
      await refreshCompanies(companyMode);
      setCompanyNotice('');
    } catch (e) {
      setCompanyNotice(t('ui.import.failed', { reason: (e as Error).message }));
    }
  };

  if (screen === 'title')
    return (
      <>
        {sandboxPick && (
          <SandboxSizePanel
            title={t('ui.sandbox.size.title')}
            start={t('ui.sandbox.size.start')}
            onClose={() => setSandboxPick(false)}
            submit={(size) => {
              newSandbox(size);
              setSandboxPick(false);
              void onSandboxSized();
              return null;
            }}
          />
        )}
        <TitleScreen onNew={onNew} onContinue={onContinue} onCompanies={onCompanies} onSandbox={onSandbox} message={message} />
        {companyView !== null && (
          <CompanyScreen
            view={companyView}
            mode={companyMode}
            saves={companies}
            suggested={suggestCompanyName(companyMode, companies)}
            notice={companyNotice}
            onView={(v) => {
              // 画面を閉じたら、読み込み中の会社は捨てる
              if (v === null) setPendingImport(null);
              setCompanyView(v);
            }}
            onPlay={playSave}
            onStartIn={startIn}
            onRename={renameSave}
            onDuplicate={copySave}
            onExport={exportCompany}
            onDelete={removeSave}
            onImport={importCompany}
            onNewHere={onNewHere}
            importing={pendingImport !== null}
            onOverwriteWith={overwriteWithPending}
          />
        )}
      </>
    );

  const date = toDate(clock.minute, balance);

  const onSave = async () => {
    // 倒産した後は保存しない（倒産の前の保存を上書きしない）
    if (useGameStore.getState().clock.bankrupt) return;
    const data = snapshot();
    if (slotRef.current !== null) await saveSlot(slotRef.current, data);
    setMessage(t('ui.save.done'));
  };

  const onExport = () => {
    // 倒産した後の状態は書き出さない
    if (useGameStore.getState().clock.bankrupt) return;
    const blob = new Blob([exportSave(snapshot())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'my-network-guy-save.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onImport = async (file: File) => {
    try {
      load(importSave(await file.text()));
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
      <PixiStage inventoryOpen={inventoryOpen} />
      <header
        ref={headerRef}
        data-hud
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: phone ? '2px 8px' : '6px 12px',
          background: 'rgba(47, 79, 143, 0.75)',
          color: '#f4f1e6',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: phone ? '2px 10px' : 14,
          zoom: 'var(--ui-scale, 1)',
        }}
      >
        {/* お金を押すと、資金の画面を開く（サンドボックスは資金がないため、開かない） */}
        {sandbox ? (
          <span>
            <Icon name="icon/money" scale={1.5} style={{ verticalAlign: 'middle', marginTop: '-4px' }} /> ∞
          </span>
        ) : (
          <button
            aria-label={t('ui.funds.open')}
            onClick={() => openWindow('funds', '')}
            style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="icon/money" scale={1.5} style={{ verticalAlign: 'middle', marginTop: '-4px' }} /> {clock.money.toLocaleString('ja-JP')}
          </button>
        )}
        {!sandbox && (
        <button aria-label={t('ui.company.title')} onClick={() => openWindow('company', '')} style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* 会社のレベルの印と、今のレベルの中の経験値のゲージ（N66）。押すと自社の情報の画面を開く */}
          <LevelMark level={levelNow} />
          <ExpGauge companyExp={companyExp} width={phone ? 56 : 96} />
        </button>
        )}
        {!sandbox && (
        <span>
          <Icon name="icon/calendar" scale={1.5} style={{ verticalAlign: 'middle', marginTop: '-4px' }} /> {t('ui.hud.date', { year: date.year, month: date.month, day: date.day, hour: date.hour })}
        </span>
        )}
        {!sandbox && (
        <span style={{ display: 'flex', gap: 4 }}>
          {SPEEDS.map((s) => (
            <Tooltip text={s === 0 ? tipText('ui.speed.0', 'pause', !phone) : t(`ui.speed.${s}` as const)} key={s}><button aria-label={t(`ui.speed.${s}` as const)} style={hudButton(speed === s, phone)}  onClick={() => { hideTip(); setSpeed(s); }}>
              {s === 0 ? (
                <Icon name="icon/pause" scale={1} />
              ) : (
                Array.from({ length: s === 4 ? 3 : s }, (_, i) => <Icon key={i} name="icon/play" scale={1} />)
              )}
            </button></Tooltip>
          ))}
          {/* 早送りは、解放済みの 2倍・4倍・8倍を押すたびに切り替え、今の倍率を出す。1倍のボタンで戻る（N99） */}
          {(() => {
            const unlockedSpeeds = unlockedSpeedsOf(levelNow, balance);
            const shown: Speed = speed >= 2 ? speed : ((unlockedSpeeds.find((x) => x >= 2) ?? 2) as Speed);
            // 押すと変わる倍率（押すたびに解放済みの 2倍・4倍・8倍を回る）。ツールチップに今と次を出す（N130）
            const next = nextFastSpeed(speed, unlockedSpeeds) as Speed;
            const hint = speed >= 2 ? t('ui.speed.hint.next', { now: t(`ui.speed.${speed}` as const), next: t(`ui.speed.${next}` as const) }) : t('ui.speed.hint.up', { next: t(`ui.speed.${shown}` as const) });
            return (
              <Tooltip text={hint}>
                <button aria-label={hint} style={hudButton(speed >= 2, phone)} onClick={() => { hideTip(); setSpeed(next); }}>
                  {Array.from({ length: shown === 2 ? 2 : 3 }, (_, i) => <Icon key={i} name="icon/play" scale={1} />)}
                  {/* 今の倍率を文字でも出す（4倍と8倍は絵が同じため。N130） */}
                  <span style={{ marginLeft: 4 }}>{t(`ui.speed.${speed}` as const)}</span>
                </button>
              </Tooltip>
            );
          })()}
          {nightSpeed !== null && <span style={{ fontSize: 12, alignSelf: 'center' }}>{t('ui.night.fast')}</span>}
        </span>
        )}
        {/* 自動保存の印。文字は出さず、ツールチップだけ */}
        {/* 印を出していないときも場所を空けておく（出し入れでメニューボタンが動かないように） */}
        <Tooltip text={t('ui.autosave.mark')} style={{ marginLeft: 'auto' }}>
          <span
            role={saveMark !== null ? 'status' : undefined}
            aria-label={saveMark !== null ? t('ui.autosave.mark') : undefined}
            aria-hidden={saveMark === null}
            style={{ display: 'inline-flex', visibility: saveMark !== null ? 'visible' : 'hidden' }}
          >
            <Icon name="icon/save" scale={1} />
          </span>
        </Tooltip>
        <button style={hudButton(false, phone)} onClick={() => setPopup('menu')}>
          <Icon name="icon/menu" scale={1} />
        </button>
      </header>
      {/* 左上の列: 切り替えのボタンと案件の欄を縦に並べる（位置の数値を部品に持たせない・N121）。狭い画面では、列をヘッダーの下に置く（ヘッダーの高さは zoom を掛けた画面の座標なので、上端は倍率で割って渡す） */}
      <div style={{ position: 'absolute', top: phone ? (hudBottom + 6) / loadSettings().uiScale : 44, left: 8, zIndex: 5, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
        <FocusSwitch />
        <TaskPanel />
      </div>
      <Windows
        onTraining={() => {
          setHiringTab('staff');
          setHiring(true);
        }}
      />
      <PortMenu />
      <Toolbar
        onOffers={() => useGameStore.getState().toggleWindow('offers', '')}
        onShop={() => useGameStore.getState().toggleWindow('shop', '')}
        hiringOpen={hiring}
        onHire={() => {
          setHiringTab('hiring');
          setHiring(!hiring);
        }}
        inventoryOpen={inventoryOpen}
        setInventoryOpen={setInventoryOpen}
      />
      <Guide />
      {DEBUG_ENABLED && (
        <Suspense fallback={null}>
          <DebugPanel />
        </Suspense>
      )}
      {hiring && <HiringPanel tab={hiringTab} onTab={setHiringTab} onClose={() => setHiring(false)} />}
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
            onClick={() => {
              setPopup(null);
              setSpeed(0);
              setScreen('title');
              setActiveSlot(null);
            }}
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
            newSandbox(size);
            return null;
          }}
        />
      )}
      {popup === 'help' && <KeyHelp onClose={() => setPopup(null)} />}
      {popup === 'settings' && <SettingsPanel onClose={() => setPopup(null)} onOpenKeys={() => setPopup('help')} />}
      <NoticeToast />
      {speedNote && (
        <div
          style={{
            position: 'absolute',
            top: phone ? (hudBottom + 6) / loadSettings().uiScale : 48,
            left: '50%',
            transform: 'translateX(-50%)',
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
      <UpdateNotice />
      {pausedPrompt && <PausedBuildPrompt />}
      <ReportModal />
      {clock.bankrupt && (
        <Modal
          primary={onNew}
          backStyle={{ background: 'rgba(20, 20, 30, 0.8)', flexDirection: 'column', gap: 12, color: '#f4f1e6' }}
          boxStyle={{ background: 'none', border: 'none', padding: 0, maxWidth: 'none', alignItems: 'center', display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <h2 style={{ fontSize: 28, margin: 0 }}>{t('ui.gameover.title')}</h2>
          <button style={{ ...primaryButton, padding: '10px 24px', fontSize: 16 }} onClick={onNew}>
            {t('ui.gameover.retry')}
          </button>
        </Modal>
      )}
    </div>
  );
}
