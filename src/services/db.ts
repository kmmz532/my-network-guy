// IndexedDB（Dexie.js）へのセーブ・ロード。枠ごとに saveVersion を持たせる。
// 会社（経営・サンドボックス）の一覧・消す・移行前の枠の移し替えもここで行う（N133）。
import Dexie, { type Table } from 'dexie';
import { SAVE_VERSION, migrate, type GameMode, type SaveData } from './migrations';
import { LEGACY_SLOT, SLOTS } from './slots';
import type { CompanySave } from './companies';

interface SaveRecord {
  slot: number;
  saveVersion: number;
  savedAt: number;
  data: SaveData;
}

class GameDb extends Dexie {
  saves!: Table<SaveRecord, number>;

  constructor() {
    super('my-network-guy');
    this.version(1).stores({ saves: 'slot' });
  }
}

const db = new GameDb();

export const saveSlot = async (slot: number, data: SaveData): Promise<void> => {
  await db.saves.put({ slot, saveVersion: SAVE_VERSION, savedAt: Date.now(), data });
};

export const loadSlot = async (slot: number): Promise<SaveData | null> => {
  const record = await db.saves.get(slot);
  if (!record) return null;
  return migrate(record.saveVersion, record.data);
};

// 遊び方の会社の一覧（その遊び方の枠に保存されているもの）。読むときに移行を通す
export const listCompanies = async (mode: GameMode): Promise<CompanySave[]> => {
  const records = await db.saves.where('slot').anyOf([...SLOTS[mode]]).toArray();
  return records.map((r) => ({ slot: r.slot, savedAt: r.savedAt, data: migrate(r.saveVersion, r.data) }));
};

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
