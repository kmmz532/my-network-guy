// タイトルの会社の一覧の操作（改名・複製・消去・読み込み）。保存先への読み書きはここで行い、
// 画面は結果の種類（done・taken・full など）を見て知らせと画面を決める。保存先は引数で渡し、テストでは差し替える。
import { listCompanies, saveSlot, deleteSlot } from './db';
import { copyNameOf, freeSlotOf, isNameTaken, isValidCompanyName, uniqueNameFrom, type CompanySave } from './companies';
import type { GameMode, World } from '../world/world';

export interface SlotStore {
  list: (mode: GameMode) => Promise<CompanySave[]>;
  save: (slot: number, data: World) => Promise<void>;
  remove: (slot: number) => Promise<void>;
}

export const dbSlotStore: SlotStore = {
  list: listCompanies,
  save: saveSlot,
  remove: deleteSlot,
};

export type RenameResult = { kind: 'invalid' } | { kind: 'taken'; saves: CompanySave[] } | { kind: 'done'; saves: CompanySave[] };

// 社名を変える（同じ遊び方の中で、同じ名前は不可）。社名の形が悪ければ、一覧を読まずに返す
export async function renameCompany(store: SlotStore, mode: GameMode, save: CompanySave, name: string): Promise<RenameResult> {
  const trimmed = name.trim();
  if (!isValidCompanyName(trimmed)) return { kind: 'invalid' };
  const list = await store.list(mode);
  if (isNameTaken(trimmed, list.filter((s) => s.slot !== save.slot))) return { kind: 'taken', saves: list };
  await store.save(save.slot, { ...save.data, name: trimmed });
  return { kind: 'done', saves: await store.list(mode) };
}

export type CopyResult = { kind: 'full'; saves: CompanySave[] } | { kind: 'done'; saves: CompanySave[] };

// 複製する（空いた枠に同じ会社を写し、社名に「（コピー）」を付ける）。空きがなければ、一覧を返す
export async function copyCompany(store: SlotStore, mode: GameMode, save: CompanySave): Promise<CopyResult> {
  const list = await store.list(mode);
  const free = freeSlotOf(mode, list);
  if (free === null) return { kind: 'full', saves: list };
  await store.save(free, { ...save.data, name: copyNameOf(save.data.name, list) });
  return { kind: 'done', saves: await store.list(mode) };
}

// 消す（元に戻せない）。消したあとの一覧を返す
export async function deleteCompany(store: SlotStore, mode: GameMode, save: CompanySave): Promise<CompanySave[]> {
  await store.remove(save.slot);
  return store.list(mode);
}

// 読み込んだ会社を、選んだ枠に入れる（上書きの確認のあと）。社名は同じ枠以外と重ならないように付け直す
export async function overwriteCompany(store: SlotStore, mode: GameMode, save: CompanySave, data: World): Promise<CompanySave[]> {
  const list = await store.list(mode);
  await store.save(save.slot, { ...data, name: uniqueNameFrom(data.name, list.filter((s) => s.slot !== save.slot)) });
  return store.list(mode);
}

export type ImportResult =
  | { kind: 'wrongMode' }
  // 空きがないため、上書きする枠を選ばせる
  | { kind: 'held'; data: World; saves: CompanySave[] }
  | { kind: 'done'; saves: CompanySave[] };

// ファイルから読んだ会社を、空いた枠に入れる。同じ遊び方の会社だけ。同じ社名があれば番号を付ける
export async function importCompany(store: SlotStore, mode: GameMode, data: World): Promise<ImportResult> {
  if (data.mode !== mode) return { kind: 'wrongMode' };
  const list = await store.list(mode);
  const free = freeSlotOf(mode, list);
  if (free === null) return { kind: 'held', data, saves: list };
  await store.save(free, { ...data, name: uniqueNameFrom(data.name, list) });
  return { kind: 'done', saves: await store.list(mode) };
}
