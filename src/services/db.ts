// IndexedDB（Dexie.js）へのセーブ・ロード。スロットごとに saveVersion を持たせる。
import Dexie, { type Table } from 'dexie';
import { SAVE_VERSION, migrate, type SaveData } from './migrations';

interface SaveRecord {
  slot: number;
  saveVersion: number;
  savedAt: number;
  data: SaveData;
}

class GameDb extends Dexie {
  saves!: Table<SaveRecord, number>;

  constructor() {
    super('network-ya');
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
