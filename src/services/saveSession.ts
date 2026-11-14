// 遊んでいる会社のセーブ。React の外に置き、ゲームのストアを見張って自動保存する。
// 画面に出す値（遊んでいる枠・保存の印・保存の失敗）だけを小さなストアに持ち、画面はそれを購読する。
import { create } from 'zustand';
import { useGameStore } from '../stores/useGameStore';
import { loadSettings, type AutoSaveMode } from '../settings/settings';
import { createSaveQueue, isAutoSaveDue } from './autoSave';
import { saveSlot } from './db';
import { exportSave, importSave } from './saveFile';
import type { Company } from '../company/company';

export interface SaveSessionView {
  // 遊んでいる会社の枠（タイトルでは null）
  slot: number | null;
  // 最後に自動保存した時刻（保存の印を出すため）
  savedAt: number | null;
  // 自動保存に失敗したとき true（知らせたら画面が false に戻す）
  failed: boolean;
}

// セーブに使うもの。テストでは差し替える
export interface SaveSessionDeps {
  write: (slot: number, data: Company) => Promise<void>;
  game: Pick<typeof useGameStore, 'getState' | 'subscribe'>;
  autoSaveMode: () => AutoSaveMode;
  now: () => number;
}

export function createSaveSession(deps: SaveSessionDeps) {
  const view = create<SaveSessionView>(() => ({ slot: null, savedAt: null, failed: false }));

  // 倒産した後の状態は保存しない（倒産の前の保存を残し、読み込みで倒産の前からやり直せるようにする）
  const writeNow = async (): Promise<boolean> => {
    const { slot } = view.getState();
    if (slot === null) throw new Error('遊んでいる会社の枠がない');
    if (deps.game.getState().clock.bankrupt) return false;
    await deps.write(slot, deps.game.getState().snapshot());
    return true;
  };

  // 自動保存は直列にする。実行中に次の要求が来たら、終わってから1回だけ書く
  const queue = createSaveQueue(async () => {
    try {
      if (await writeNow()) view.setState({ savedAt: deps.now() });
    } catch {
      view.setState({ failed: true });
    }
  });

  const autoSave = (): Promise<void> => (deps.autoSaveMode() === 'off' ? Promise.resolve() : queue());

  return {
    view,
    // 会社を開いたとき・新しく始めたときに、その会社の枠を決める。タイトルへ戻るときは null
    open(slot: number | null) {
      view.setState({ slot, savedAt: null, failed: false });
    },
    // 保存の失敗を知らせたあとに呼ぶ
    acknowledgeFailure() {
      view.setState({ failed: false });
    },
    // メニューの「保存」。倒産した後は保存せず false を返す
    save: writeNow,
    autoSave,
    // 書き出す内容（倒産した後は書き出さない）
    exportText(): string | null {
      if (deps.game.getState().clock.bankrupt) return null;
      return exportSave(deps.game.getState().snapshot());
    },
    // 読み込んだ内容でゲームを置き換える。形が合わなければ例外
    importText(text: string) {
      deps.game.getState().load(importSave(text));
    },
    // ゲームの画面にいる間、自動保存の契機を見張る。戻り値で見張りをやめる
    // 契機: 設定の間隔の朝0時を越えた・案件を納品した（検収に通った）・ページを隠した・閉じた
    watch(): () => void {
      const offGame = deps.game.subscribe((next, prev) => {
        if (isAutoSaveDue(deps.autoSaveMode(), prev.clock.minute, next.clock.minute)) void autoSave();
        if (next.lastReport !== prev.lastReport && next.lastReport?.passed) void autoSave();
      });
      const onVisibility = () => {
        if (document.visibilityState === 'hidden') void autoSave();
      };
      const onPageHide = () => void autoSave();
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pagehide', onPageHide);
      return () => {
        offGame();
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pagehide', onPageHide);
      };
    },
  };
}

export type SaveSession = ReturnType<typeof createSaveSession>;

export const saveSession = createSaveSession({
  write: saveSlot,
  game: useGameStore,
  autoSaveMode: () => loadSettings().autoSave,
  now: () => Date.now(),
});

export const useSaveSession = saveSession.view;
