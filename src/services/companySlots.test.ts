import { describe, expect, it } from 'vitest';
import type { CompanySave } from './companies';
import { copyCompany, deleteCompany, importCompany, overwriteCompany, renameCompany, type SlotStore } from './companySlots';
import { GameMode, Company } from '../world/world';

// 保存先の代わり（枠の番号ごとに会社を持つ）
const fakeStore = (initial: CompanySave[]) => {
  const slots = new Map<number, CompanySave>(initial.map((s) => [s.slot, s]));
  const store: SlotStore = {
    list: async (mode: GameMode) => [...slots.values()].filter((s) => s.data.mode === mode).sort((a, b) => a.slot - b.slot),
    save: async (slot, data) => {
      slots.set(slot, { slot, savedAt: 0, data });
    },
    remove: async (slot) => {
      slots.delete(slot);
    },
  };
  return { store, slots };
};

// 枠の番号は SLOTS の値（経営 11〜15、サンドボックス 21〜23）
const company = (slot: number, name: string, mode: GameMode = 'career'): CompanySave => ({
  slot,
  savedAt: slot,
  data: { name, mode } as unknown as Company,
});

const data = (name: string, mode: GameMode = 'career') => ({ name, mode }) as unknown as Company;

const CAREER_FULL = [11, 12, 13, 14, 15].map((slot) => company(slot, `社${slot}`));

describe('renameCompany', () => {
  it('社名の形が悪ければ、保存せずに invalid を返す', async () => {
    const { store, slots } = fakeStore([company(11, 'A社')]);
    expect(await renameCompany(store, 'career', company(11, 'A社'), '   ')).toEqual({ kind: 'invalid' });
    expect(slots.get(11)?.data.name).toBe('A社');
  });

  it('同じ遊び方の別の会社と同じ名前なら taken を返し、保存しない', async () => {
    const { store, slots } = fakeStore([company(11, 'A社'), company(12, 'B社')]);
    const result = await renameCompany(store, 'career', company(11, 'A社'), ' B社 ');
    expect(result.kind).toBe('taken');
    expect(slots.get(11)?.data.name).toBe('A社');
  });

  it('自分の今の名前にはそのまま変えられる', async () => {
    const { store, slots } = fakeStore([company(11, 'A社')]);
    const result = await renameCompany(store, 'career', company(11, 'A社'), ' A社 ');
    expect(result.kind).toBe('done');
    expect(slots.get(11)?.data.name).toBe('A社');
  });

  it('別の遊び方の同じ名前とは重ならない', async () => {
    const { store, slots } = fakeStore([company(11, 'A社'), company(21, 'B社', 'sandbox')]);
    const result = await renameCompany(store, 'career', company(11, 'A社'), 'B社');
    expect(result.kind).toBe('done');
    expect(slots.get(11)?.data.name).toBe('B社');
  });
});

describe('copyCompany', () => {
  it('空いた枠に写し、社名に「（コピー）」を付ける', async () => {
    const { store, slots } = fakeStore([company(11, 'A社')]);
    const result = await copyCompany(store, 'career', company(11, 'A社'));
    expect(result.kind).toBe('done');
    expect(slots.get(12)?.data.name).toBe('A社（コピー）');
    expect(result.saves).toHaveLength(2);
  });

  it('空きがなければ full を返し、保存しない', async () => {
    const { store, slots } = fakeStore(CAREER_FULL);
    const result = await copyCompany(store, 'career', CAREER_FULL[0]);
    expect(result.kind).toBe('full');
    expect(slots.size).toBe(5);
  });
});

describe('deleteCompany', () => {
  it('枠を消し、消したあとの一覧を返す', async () => {
    const { store, slots } = fakeStore([company(11, 'A社'), company(12, 'B社')]);
    const saves = await deleteCompany(store, 'career', company(11, 'A社'));
    expect(slots.has(11)).toBe(false);
    expect(saves.map((s) => s.data.name)).toEqual(['B社']);
  });
});

describe('overwriteCompany', () => {
  it('選んだ枠に入れ、同じ枠以外の社名と重なるときは番号を付ける', async () => {
    const { store, slots } = fakeStore([company(11, 'A社'), company(12, 'B社')]);
    await overwriteCompany(store, 'career', company(11, 'A社'), data('B社'));
    expect(slots.get(11)?.data.name).not.toBe('B社');
    expect(slots.get(11)?.data.name).toContain('B社');
  });

  it('同じ枠の社名は重なりの対象にしない（自分の枠を上書きするときは、元の名前を残せる）', async () => {
    const { store, slots } = fakeStore([company(11, 'A社')]);
    await overwriteCompany(store, 'career', company(11, 'A社'), data('A社'));
    expect(slots.get(11)?.data.name).toBe('A社');
  });
});

describe('importCompany', () => {
  it('遊び方が違う会社は wrongMode を返し、保存しない', async () => {
    const { store, slots } = fakeStore([]);
    expect(await importCompany(store, 'career', data('X', 'sandbox'))).toEqual({ kind: 'wrongMode' });
    expect(slots.size).toBe(0);
  });

  it('空いた枠に入れ、同じ社名があれば番号を付ける', async () => {
    const { store, slots } = fakeStore([company(11, 'A社')]);
    const result = await importCompany(store, 'career', data('A社'));
    expect(result.kind).toBe('done');
    expect(slots.get(12)?.data.name).not.toBe('A社');
    expect(slots.get(12)?.data.name).toContain('A社');
  });

  it('空きがなければ held を返し、読み込んだ中身を持たせる（上書きする枠を選ばせる）', async () => {
    const { store, slots } = fakeStore(CAREER_FULL);
    const read = data('X');
    const result = await importCompany(store, 'career', read);
    expect(result.kind).toBe('held');
    if (result.kind === 'held') expect(result.data).toBe(read);
    expect(slots.size).toBe(5);
  });
});
