// IndexedDB（Dexie.js）へのセーブ・ロード。枠ごとに saveVersion を持たせる。
// 会社（経営・サンドボックス）の一覧・消す・移行前の枠の移し替えもここで行う（N133）。
import Dexie, { type Table } from 'dexie';
import { SAVE_VERSION, migrate } from './migrations';
import type { GameMode, Company } from '../company/company';
import { FIRST_SLOT, LEGACY_SLOT } from './slots';
import type { CompanySave } from './companies';
import { recordsOfMode, type BrokenSlot, type ModeRecords, type SaveRecord } from './saveRecords';
import { freeSlotOf } from './companies';

class GameDb extends Dexie {
  saves!: Table<SaveRecord, number>;

  constructor() {
    super('my-network-guy');
    this.version(1).stores({ saves: 'slot' });
  }
}

const db = new GameDb();

export const saveSlot = async (slot: number, data: Company): Promise<void> => {
  await db.saves.put({ slot, saveVersion: SAVE_VERSION, savedAt: Date.now(), data });
};

export const loadSlot = async (slot: number): Promise<Company | null> => {
  const record = await db.saves.get(slot);
  if (!record) return null;
  return migrate(record.saveVersion, record.data);
};

// 遊び方の会社の一覧（記録の遊び方がその遊び方のもの）。読むときに移行を通す。移行できない枠は含めない（listBrokenSlots で受け取る）
export const listCompanies = async (mode: GameMode): Promise<CompanySave[]> => recordsOfMode(await slotRecords(), mode).saves;

// 遊び方の会社と読めない枠を、1回の読み込みでまとめて返す
export const listSlots = async (mode: GameMode): Promise<ModeRecords> => recordsOfMode(await slotRecords(), mode);

// 遊び方の読めない枠（移行で例外になった枠）
export const listBrokenSlots = async (mode: GameMode): Promise<BrokenSlot[]> => recordsOfMode(await slotRecords(), mode).broken;

// 会社の枠の記録（移行前の枠は含めない）
const slotRecords = (): Promise<SaveRecord[]> => db.saves.where('slot').aboveOrEqual(FIRST_SLOT).toArray();

// 使われている枠の番号（遊び方を問わない）
export const listOccupiedSlots = async (): Promise<number[]> => (await db.saves.where('slot').aboveOrEqual(FIRST_SLOT).primaryKeys()) as number[];

// 会社を消す（元に戻せない）
export const deleteSlot = async (slot: number): Promise<void> => {
  await db.saves.delete(slot);
};

// 移行前の枠（経営は枠1、サンドボックスは枠2）のセーブを、範囲の空いた枠へ移す。
// 移す先がなければ、移行前の枠はそのまま残す（セーブを消さない）
export const moveLegacySlots = async (): Promise<void> => {
  for (const mode of Object.keys(LEGACY_SLOT) as GameMode[]) {
    const legacy = await db.saves.get(LEGACY_SLOT[mode]);
    if (!legacy) continue;
    const free = freeSlotOf(await listOccupiedSlots());
    if (free === null) continue;
    await db.transaction('rw', db.saves, async () => {
      await db.saves.put({ ...legacy, slot: free });
      await db.saves.delete(LEGACY_SLOT[mode]);
    });
  }
};
