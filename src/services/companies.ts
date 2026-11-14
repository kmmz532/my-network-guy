// 会社（セーブの枠）の規則。画面と保存の両方で使う純粋な関数だけを置く（N133）
import type { GameMode, Company } from '../world/world';
import { DEFAULT_COMPANY_NAME, DEFAULT_SANDBOX_NAME } from './migrations';
import { SLOTS } from './slots';

// 保存されている会社（枠・保存の日時・中身）
export interface CompanySave {
  slot: number;
  savedAt: number;
  data: Company;
}

// 社名の長さの上限（全角12文字。HUD や一覧で切れないように）
export const MAX_COMPANY_NAME = 12;

// 社名として使えるか（空白だけ・空は不可。前後の空白は除いて判定する）
export const isValidCompanyName = (name: string): boolean => {
  const trimmed = name.trim();
  return trimmed !== '' && [...trimmed].length <= MAX_COMPANY_NAME;
};

// 遊び方の既定の社名
export const defaultNameOf = (mode: GameMode): string => (mode === 'sandbox' ? DEFAULT_SANDBOX_NAME : DEFAULT_COMPANY_NAME);

// 空いている枠（最も小さい番号）。全部埋まっていれば null
export const freeSlotOf = (mode: GameMode, saves: readonly CompanySave[]): number | null => {
  const used = new Set(saves.map((s) => s.slot));
  return SLOTS[mode].find((slot) => !used.has(slot)) ?? null;
};

// 社名が既に使われているか
export const isNameTaken = (name: string, saves: readonly CompanySave[]): boolean => {
  const trimmed = name.trim();
  return saves.some((s) => s.data.name === trimmed);
};

// 既定の社名に番号を付けて、使われていない名前を作る（「パケットカンパニー 2」など）
export const uniqueNameFrom = (base: string, saves: readonly CompanySave[]): string => {
  if (!isNameTaken(base, saves)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!isNameTaken(candidate, saves)) return candidate;
  }
};

// 新しく始めるときの社名の初期値
export const suggestCompanyName = (mode: GameMode, saves: readonly CompanySave[]): string => uniqueNameFrom(defaultNameOf(mode), saves);

// 複製するときの社名（「（コピー）」を付け、使われていなければ番号も付ける）
export const copyNameOf = (name: string, saves: readonly CompanySave[]): string => {
  const base = `${name}（コピー）`;
  return uniqueNameFrom(base, saves);
};

// 最後に保存した会社（「続きから」で開く会社）。1つもなければ null
export const latestCompany = (saves: readonly CompanySave[]): CompanySave | null =>
  saves.reduce<CompanySave | null>((best, s) => (best === null || s.savedAt > best.savedAt ? s : best), null);

// 一覧の並び（最後に保存した日時の新しい順）
export const sortByRecent = (saves: readonly CompanySave[]): CompanySave[] => [...saves].sort((a, b) => b.savedAt - a.savedAt);
