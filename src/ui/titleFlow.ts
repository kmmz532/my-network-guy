// タイトル場面の流れ。何を出しているか（メニュー・サンドボックスの広さ・会社の枠の画面）を1つの値で持ち、
// 変わり方を純粋な関数にする。保存の読み書き（非同期）は場面の部品が行い、結果をこの関数に渡す。
import { freeSlotOf, suggestCompanyName, type CompanySave } from '../services/companies';
import type { GameMode, World } from '../world/world';

// 会社の枠の画面（SaveSlotDialog）の中身
export type SaveSlotView =
  | { kind: 'list'; purpose: 'play' | 'overwrite' }
  | { kind: 'name'; slot: number; suggested: string; from: 'new' | 'overwrite' }
  | { kind: 'rename'; save: CompanySave }
  | { kind: 'confirmOverwrite'; save: CompanySave }
  | { kind: 'delete'; save: CompanySave };

// タイトルで出している画面
export type TitlePanel =
  | { kind: 'menu' }
  // タイトルから新しく始めるサンドボックスの広さを選ぶ
  | { kind: 'sandboxSize' }
  | { kind: 'slots'; view: SaveSlotView };

export interface TitleState {
  panel: TitlePanel;
  // 開いている遊び方（会社の一覧・新しく始める会社の種類）
  mode: GameMode;
  // 最後に読み直した会社の一覧
  saves: readonly CompanySave[];
  // 会社の枠の画面に出す知らせ
  notice: string;
  // メニューに出す知らせ
  message: string;
  // 枠が全部埋まっているときに読み込んだ会社（上書きする枠を選んでから入れる）
  pendingImport: World | null;
}

export const initialTitleState: TitleState = { panel: { kind: 'menu' }, mode: 'career', saves: [], notice: '', message: '', pendingImport: null };

// 一覧を読み直した結果を伴う変化には saves を持たせる
export type TitleEvent =
  // 「新しく始める」（経営）
  | { type: 'newCareer'; saves: readonly CompanySave[] }
  // 「コンティニュー」（経営）
  | { type: 'continueCareer'; saves: readonly CompanySave[]; noneMessage: string }
  // 「サンドボックス」
  | { type: 'sandbox'; saves: readonly CompanySave[] }
  // サンドボックスの広さを決めた
  | { type: 'sandboxSized'; saves: readonly CompanySave[] }
  // 一覧の「新しく作る」でサンドボックスの広さを選ぶ
  | { type: 'openSandboxSize' }
  | { type: 'closeSandboxSize' }
  // 会社の枠の画面を切り替える。null は閉じる（読み込み中の会社は捨てる）
  | { type: 'show'; view: SaveSlotView | null }
  // 一覧を読み直した。知らせを消す。view があればその画面にする
  | { type: 'refreshed'; saves: readonly CompanySave[]; view?: SaveSlotView }
  // 一覧を読み直したが知らせは残す
  | { type: 'listed'; saves: readonly CompanySave[] }
  | { type: 'notice'; notice: string }
  // 読み込んだ会社を、枠を選んで入れるために持つ
  | { type: 'importHeld'; data: World; saves: readonly CompanySave[]; notice: string }
  // 読み込んだ会社を選んだ枠に入れた。一覧（続けて遊ぶ）に戻る
  | { type: 'importDone'; saves: readonly CompanySave[] };

const slots = (view: SaveSlotView): TitlePanel => ({ kind: 'slots', view });

// 空いた枠があれば社名を決める画面、全部埋まっていれば上書きする会社を選ぶ一覧
const startOrOverwrite = (mode: GameMode, saves: readonly CompanySave[]): TitlePanel => {
  const free = freeSlotOf(mode, saves);
  return free !== null ? slots({ kind: 'name', slot: free, suggested: suggestCompanyName(mode, saves), from: 'new' }) : slots({ kind: 'list', purpose: 'overwrite' });
};

export function titleReducer(state: TitleState, event: TitleEvent): TitleState {
  switch (event.type) {
    case 'newCareer':
      return { ...state, mode: 'career', notice: '', saves: event.saves, panel: startOrOverwrite('career', event.saves) };
    case 'continueCareer':
      if (event.saves.length === 0) return { ...state, mode: 'career', notice: '', saves: event.saves, message: event.noneMessage };
      return { ...state, mode: 'career', notice: '', saves: event.saves, panel: slots({ kind: 'list', purpose: 'play' }) };
    case 'sandbox':
      return event.saves.length > 0
        ? { ...state, mode: 'sandbox', saves: event.saves, panel: slots({ kind: 'list', purpose: 'play' }) }
        : { ...state, mode: 'sandbox', saves: event.saves, panel: { kind: 'sandboxSize' } };
    case 'sandboxSized':
      return { ...state, mode: 'sandbox', saves: event.saves, panel: startOrOverwrite('sandbox', event.saves) };
    case 'openSandboxSize':
      return { ...state, panel: { kind: 'sandboxSize' } };
    case 'closeSandboxSize':
      return { ...state, panel: { kind: 'menu' } };
    case 'show':
      return event.view === null ? { ...state, panel: { kind: 'menu' }, pendingImport: null } : { ...state, panel: slots(event.view) };
    case 'refreshed':
      return { ...state, saves: event.saves, notice: '', panel: event.view ? slots(event.view) : state.panel };
    case 'listed':
      return { ...state, saves: event.saves };
    case 'notice':
      return { ...state, notice: event.notice };
    case 'importHeld':
      return { ...state, saves: event.saves, pendingImport: event.data, notice: event.notice, panel: slots({ kind: 'list', purpose: 'overwrite' }) };
    case 'importDone':
      return { ...state, saves: event.saves, pendingImport: null, notice: '', panel: slots({ kind: 'list', purpose: 'play' }) };
  }
}
