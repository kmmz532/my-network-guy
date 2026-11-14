// タイトルの場面。メニューと、会社の枠の画面、サンドボックスの広さを選ぶ画面を出す。
// 何を出すかは titleFlow の値が決める。保存の読み書きはここで行い、結果を titleFlow に渡す。
import { useEffect, useReducer } from 'react';
import { t } from '../../i18n/t';
import { listSlots } from '../../services/db';
import { suggestCompanyName, type CompanySave } from '../../services/companies';
import { copyCompany, dbSlotStore, deleteBrokenSlot, deleteCompany, importCompany, overwriteCompany, renameCompany } from '../../services/companySlots';
import { exportSave, importSave } from '../../services/saveFile';
import { saveSession } from '../../services/saveSession';
import { Speed, useGameStore } from '../../stores/useGameStore';
import { initialTitleState, titleReducer } from '../../ui/titleFlow';
import { SandboxSizePanel } from '../SandboxSizePanel';
import { keyRouter } from '../../input/keyRouter';
import { SaveSlotDialog } from './SaveSlotDialog';
import { TitleScreen } from './TitleScreen';
import { loadSettings } from '../../settings/settings';
import { isSpeedUnlocked } from '../../sim/speed';
import { levelOf } from '../../sim/level';
import { balance } from 'virtual:game-data';
import { useSceneStore } from '../../stores/useSceneStore';

// 会社を開いて遊ぶ・新しく始めるとき、ゲームの場面へ移る
const TitleScene = ({ opening }: { opening?: 'newCareer' }) => {
  const [state, dispatch] = useReducer(titleReducer, initialTitleState);
  const { panel, mode, saves, broken, notice, message, pendingImport } = state;

  // 読み込みに失敗したときは、メニューに知らせを出す（タイトルの操作は止めない）
  const loadFailed = (e: unknown) => dispatch({ type: 'menuMessage', message: t('ui.title.loadFailed', { reason: (e as Error).message }) });

  // 新しく始める（経営）。空いた枠があれば社名を決めて始める。全部埋まっていれば、上書きする会社を選ばせる（N132）
  const onNew = async () => {
    try {
      dispatch({ type: 'newCareer', ...(await listSlots('career')) });
    } catch (e) {
      loadFailed(e);
    }
  };

  // 「コンティニュー」は会社の一覧を開く（最後に遊んだ会社を先頭に出す。1社だけでも一覧を開く・N157）
  const onContinue = async () => {
    try {
      dispatch({ type: 'continueCareer', ...(await listSlots('career')), noneMessage: t('ui.title.none') });
    } catch (e) {
      loadFailed(e);
    }
  };

  // サンドボックスは、保存があれば一覧を開き（「新しく作る」も一覧に置く）、なければ広さを選んで始める
  const onSandbox = async () => {
    try {
      dispatch({ type: 'sandbox', ...(await listSlots('sandbox')) });
    } catch (e) {
      loadFailed(e);
    }
  };

  // 広さを決めたサンドボックスは、社名を決めてから始める
  const onSandboxSized = async () => {
    try {
      dispatch({ type: 'sandboxSized', ...(await listSlots('sandbox')) });
    } catch (e) {
      loadFailed(e);
    }
  };

  // 一覧の「新しく作る」: 経営は社名、サンドボックスは広さを選ぶ
  const onNewHere = () => {
    if (mode === 'sandbox') dispatch({ type: 'openSandboxSize' });
    else void onNew();
  };

  // ゲームの場面へ移る（タイトルで会社を決めたあと）
  const onEnter = () => {
    // 保存を、ブラウザが勝手に消さないように頼む（断られても遊べる・N133）
    void navigator.storage?.persist?.();
    // 時間を進める初期の速さは設定で決める
    // 解放されていない速さは、1倍にする（4倍は会社のレベル3で解放される・N99）
    const wanted = loadSettings().startSpeed;
    const game = useGameStore.getState();
    game.setSpeed(isSpeedUnlocked(wanted, levelOf(game.companyExp, balance), balance) ? (wanted as Speed) : 1);
    useSceneStore.getState().setScene({ kind: 'game' });
  };

  // キー入力の受け口。タイトルの場面は、キーの表（ゲームのキー）を使わない
  useEffect(() => keyRouter.attach(window, { table: false }), []);
  useEffect(() => {
    if (opening === 'newCareer') void onNew();
  }, []);

  // 会社を開いて遊ぶ（その会社の枠に保存し続ける）
  const playSave = (save: CompanySave) => {
    useGameStore.getState().load(save.data);
    saveSession.open(save.slot);
    onEnter();
  };

  // 社名を決めて始める。経営は新しい会社、サンドボックスは広さを決めた今の状態に社名を付ける
  const startIn = async (slot: number, name: string) => {
    const trimmed = name.trim();
    if (mode === 'career') useGameStore.getState().newGame(trimmed);
    else useGameStore.getState().renameCompany(trimmed);
    saveSession.open(slot);
    await saveSession.save();
    onEnter();
  };

  // 社名を変える（同じ遊び方の中で、同じ名前は不可）
  const renameSave = async (save: CompanySave, name: string) => {
    const result = await renameCompany(dbSlotStore, mode, save, name);
    if (result.kind === 'invalid') return dispatch({ type: 'notice', notice: t('ui.company.name.hint', { max: 12 }) });
    if (result.kind === 'taken') {
      dispatch({ type: 'listed', saves: result.saves });
      return dispatch({ type: 'notice', notice: t('ui.company.name.taken') });
    }
    dispatch({ type: 'refreshed', saves: result.saves, view: { kind: 'list', purpose: 'play' } });
  };

  // 複製する（空いた枠に同じ会社を写し、社名に「（コピー）」を付ける）。空きがなければ知らせを出す
  const copySave = async (save: CompanySave) => {
    const result = await copyCompany(dbSlotStore, mode, save);
    if (result.kind === 'full') {
      dispatch({ type: 'listed', saves: result.saves });
      return dispatch({ type: 'notice', notice: t('ui.company.copy.full') });
    }
    dispatch({ type: 'refreshed', saves: result.saves });
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
    const saves = await deleteCompany(dbSlotStore, mode, save);
    dispatch({ type: 'refreshed', saves, view: { kind: 'list', purpose: 'play' } });
  };

  // 読めない枠を消す（元に戻せない）
  const removeBroken = async (slot: number) => {
    const result = await deleteBrokenSlot(dbSlotStore, mode, slot);
    dispatch({ type: 'refreshed', saves: result.saves, broken: result.broken, view: { kind: 'list', purpose: 'play' } });
  };

  // 読み込んだ会社を、選んだ会社の枠に入れる（上書きの確認のあと。N133）
  const overwriteWithPending = async (save: CompanySave) => {
    if (pendingImport === null) return;
    const saves = await overwriteCompany(dbSlotStore, mode, save, pendingImport);
    dispatch({ type: 'importDone', saves });
  };

  // ファイルから読み込む。同じ遊び方の会社だけ。空いた枠に入れ、同じ社名があれば番号を付ける
  const importFromFile = async (file: File) => {
    try {
      const result = await importCompany(dbSlotStore, mode, importSave(await file.text()));
      if (result.kind === 'wrongMode') return dispatch({ type: 'notice', notice: t('ui.company.import.mode') });
      // 空きがなければ、上書きする会社を選ばせる（上書きの確認は N132 と同じ）
      if (result.kind === 'held') return dispatch({ type: 'importHeld', data: result.data, saves: result.saves, notice: t('ui.company.import.full') });
      dispatch({ type: 'refreshed', saves: result.saves });
    } catch (e) {
      dispatch({ type: 'notice', notice: t('ui.import.failed', { reason: (e as Error).message }) });
    }
  };

  return (
    <>
      {panel.kind === 'sandboxSize' && (
        <SandboxSizePanel
          title={t('ui.sandbox.size.title')}
          start={t('ui.sandbox.size.start')}
          onClose={() => dispatch({ type: 'closeSandboxSize' })}
          submit={(size) => {
            useGameStore.getState().newSandbox(size);
            dispatch({ type: 'closeSandboxSize' });
            void onSandboxSized();
            return null;
          }}
        />
      )}
      <TitleScreen onNew={onNew} onContinue={onContinue} onSandbox={onSandbox} message={message} locked={panel.kind === 'slots'} />
      {panel.kind === 'slots' && (
        <SaveSlotDialog
          view={panel.view}
          mode={mode}
          saves={saves}
          broken={broken}
          suggested={suggestCompanyName(mode, saves)}
          notice={notice}
          onView={(view) => dispatch({ type: 'show', view })}
          onPlay={playSave}
          onStartIn={startIn}
          onRename={renameSave}
          onDuplicate={copySave}
          onExport={exportCompany}
          onDelete={removeSave}
          onDeleteBroken={removeBroken}
          onImport={importFromFile}
          onNewHere={onNewHere}
          importing={pendingImport !== null}
          onOverwriteWith={overwriteWithPending}
        />
      )}
    </>
  );
};

export default TitleScene;
