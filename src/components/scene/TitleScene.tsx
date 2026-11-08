// タイトルの場面。メニューと、会社の枠の画面、サンドボックスの広さを選ぶ画面を出す。
// 何を出すかは titleFlow の値が決める。保存の読み書きはここで行い、結果を titleFlow に渡す。
import { useEffect, useReducer } from 'react';
import { t } from '../../i18n/t';
import { deleteSlot, listCompanies, saveSlot } from '../../services/db';
import { copyNameOf, freeSlotOf, isNameTaken, isValidCompanyName, suggestCompanyName, uniqueNameFrom, type CompanySave } from '../../services/companies';
import { exportSave, importSave } from '../../services/saveFile';
import { saveSession } from '../../services/saveSession';
import { useGameStore } from '../../stores/useGameStore';
import { initialTitleState, titleReducer } from '../../ui/titleFlow';
import { SandboxSizePanel } from '../SandboxSizePanel';
import { SaveSlotDialog } from './SaveSlotDialog';
import { TitleScreen } from './TitleScreen';

// 会社を開いて遊ぶ・新しく始めるとき、ゲームの場面へ移る
export function TitleScene({ onEnter, opening }: { onEnter: () => void; opening?: 'newCareer' }) {
  const [state, dispatch] = useReducer(titleReducer, initialTitleState);
  const { panel, mode, saves, notice, message, pendingImport } = state;

  // 新しく始める（経営）。空いた枠があれば社名を決めて始める。全部埋まっていれば、上書きする会社を選ばせる（N132）
  const onNew = async () => dispatch({ type: 'newCareer', saves: await listCompanies('career') });

  // 「コンティニュー」は会社の一覧を開く（最後に遊んだ会社を先頭に出す。1社だけでも一覧を開く・N157）
  const onContinue = async () => dispatch({ type: 'continueCareer', saves: await listCompanies('career'), noneMessage: t('ui.title.none') });

  // サンドボックスは、保存があれば一覧を開き（「新しく作る」も一覧に置く）、なければ広さを選んで始める
  const onSandbox = async () => dispatch({ type: 'sandbox', saves: await listCompanies('sandbox') });

  // 広さを決めたサンドボックスは、社名を決めてから始める
  const onSandboxSized = async () => dispatch({ type: 'sandboxSized', saves: await listCompanies('sandbox') });

  // 一覧の「新しく作る」: 経営は社名、サンドボックスは広さを選ぶ
  const onNewHere = () => {
    if (mode === 'sandbox') dispatch({ type: 'openSandboxSize' });
    else void onNew();
  };

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
    const trimmed = name.trim();
    if (!isValidCompanyName(trimmed)) return dispatch({ type: 'notice', notice: t('ui.company.name.hint', { max: 12 }) });
    const list = await listCompanies(mode);
    if (isNameTaken(trimmed, list.filter((s) => s.slot !== save.slot))) {
      dispatch({ type: 'listed', saves: list });
      return dispatch({ type: 'notice', notice: t('ui.company.name.taken') });
    }
    await saveSlot(save.slot, { ...save.data, name: trimmed });
    dispatch({ type: 'refreshed', saves: await listCompanies(mode), view: { kind: 'list', purpose: 'play' } });
  };

  // 複製する（空いた枠に同じ会社を写し、社名に「（コピー）」を付ける）
  const copySave = async (save: CompanySave) => {
    const list = await listCompanies(mode);
    const free = freeSlotOf(mode, list);
    if (free === null) {
      dispatch({ type: 'listed', saves: list });
      return dispatch({ type: 'notice', notice: t('ui.company.copy.full') });
    }
    await saveSlot(free, { ...save.data, name: copyNameOf(save.data.name, list) });
    dispatch({ type: 'refreshed', saves: await listCompanies(mode) });
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
    dispatch({ type: 'refreshed', saves: await listCompanies(mode), view: { kind: 'list', purpose: 'play' } });
  };

  // 読み込んだ会社を、選んだ会社の枠に入れる（上書きの確認のあと。N133）
  const overwriteWithPending = async (save: CompanySave) => {
    if (pendingImport === null) return;
    const list = await listCompanies(mode);
    await saveSlot(save.slot, { ...pendingImport, name: uniqueNameFrom(pendingImport.name, list.filter((s) => s.slot !== save.slot)) });
    dispatch({ type: 'importDone', saves: await listCompanies(mode) });
  };

  // ファイルから読み込む。同じ遊び方の会社だけ。空いた枠に入れ、同じ社名があれば番号を付ける
  const importCompany = async (file: File) => {
    try {
      const data = importSave(await file.text());
      if (data.mode !== mode) return dispatch({ type: 'notice', notice: t('ui.company.import.mode') });
      const list = await listCompanies(mode);
      const free = freeSlotOf(mode, list);
      // 空きがなければ、上書きする会社を選ばせる（上書きの確認は N132 と同じ）
      if (free === null) return dispatch({ type: 'importHeld', data, saves: list, notice: t('ui.company.import.full') });
      await saveSlot(free, { ...data, name: uniqueNameFrom(data.name, list) });
      dispatch({ type: 'refreshed', saves: await listCompanies(mode) });
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
          suggested={suggestCompanyName(mode, saves)}
          notice={notice}
          onView={(view) => dispatch({ type: 'show', view })}
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
}
