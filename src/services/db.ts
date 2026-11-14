// IndexedDB（Dexie.js）へのセーブ・ロード。枠ごとに saveVersion を持たせる。
// 会社（経営・サンドボックス）の一覧・消す・移行前の枠の移し替えもここで行う（N133）。
import Dexie, { type Table } from 'dexie';
import { SAVE_VERSION, migrate } from './migrations';
import type { GameMode, Company } from '../company/company';
import { LEGACY_SLOT, SLOTS } from './slots';
import type { CompanySave } from './companies';
import { splitRecords, type BrokenSlot, type SaveRecord, type SplitRecords } from './saveRecords';

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

// 遊び方の会社の一覧（その遊び方の枠に保存されているもの）。読むときに移行を通す。移行できない枠は含めない（listBrokenSlots で受け取る）
export const listCompanies = async (mode: GameMode): Promise<CompanySave[]> => splitRecords(await modeRecords(mode)).saves;

// 遊び方の会社と読めない枠を、1回の読み込みでまとめて返す
export const listSlots = async (mode: GameMode): Promise<SplitRecords> => splitRecords(await modeRecords(mode));

// 遊び方の読めない枠（移行で例外になった枠）
export const listBrokenSlots = async (mode: GameMode): Promise<BrokenSlot[]> => splitRecords(await modeRecords(mode)).broken;

const modeRecords = (mode: GameMode): Promise<SaveRecord[]> => db.saves.where('slot').anyOf([...SLOTS[mode]]).toArray();

// 会社を消す（元に戻せない）
export const deleteSlot = async (slot: number): Promise<void> => {
  await db.saves.delete(slot);
};

// 移行前の枠（経営は枠1、サンドボックスは枠2）のセーブを、その遊び方の空いた枠へ移す。
// 移す先がなければ、移行前の枠はそのまま残す（セーブを消さない）
export const moveLegacySlots = async (): Promise<void> => {
  for (const mode of Object.keys(LEGACY_SLOT) as GameMode[]) {
    const legacy = await db.saves.get(LEGACY_SLOT[mode]);
    if (!legacy) continue;
    const used = (await db.saves.where('slot').anyOf([...SLOTS[mode]]).primaryKeys()) as number[];
    const free = SLOTS[mode].find((slot) => !used.includes(slot));
    if (free === undefined) continue;
    await db.transaction('rw', db.saves, async () => {
      await db.saves.put({ ...legacy, slot: free });
      await db.saves.delete(LEGACY_SLOT[mode]);
    });
  }
};
