// 保存の1枠（SaveRecord）を、読める会社と読めない枠に振り分ける純粋な関数。移行に失敗した枠は、予備値で埋めずに読めない枠として返す。
import type { Company } from '../company/company';
import type { CompanySave } from './companies';
import { migrate } from './migrations';

export interface SaveRecord {
  slot: number;
  saveVersion: number;
  savedAt: number;
  data: Company;
}

// 読めない枠（枠の番号と保存の日時だけを持つ。中身は使わない）
export interface BrokenSlot {
  slot: number;
  savedAt: number;
}

export interface SplitRecords {
  saves: CompanySave[];
  broken: BrokenSlot[];
}

// 1枠ずつ移行する。移行で例外になった枠は読めない枠に入れ、ほかの枠は読めるまま返す
export const splitRecords = (records: readonly SaveRecord[]): SplitRecords => {
  const result: SplitRecords = { saves: [], broken: [] };
  for (const r of records) {
    try {
      result.saves.push({ slot: r.slot, savedAt: r.savedAt, data: migrate(r.saveVersion, r.data) });
    } catch {
      result.broken.push({ slot: r.slot, savedAt: r.savedAt });
    }
  }
  return result;
};
