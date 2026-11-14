// 会社（セーブの枠）の規則（N133）
import { describe, expect, it } from 'vitest';
import type { World } from '../world/world';
import { DEFAULT_COMPANY_NAME, DEFAULT_SANDBOX_NAME } from './migrations';
import { MAX_COMPANY_NAME, copyNameOf, freeSlotOf, isValidCompanyName, latestCompany, sortByRecent, suggestCompanyName, type CompanySave } from './companies';

const save = (slot: number, name: string, savedAt = 0, mode: 'career' | 'sandbox' = 'career'): CompanySave => ({
  slot,
  savedAt,
  data: { mode, name } as unknown as World,
});

describe('社名の規則', () => {
  it('空欄・空白だけは使えない。前後の空白は除いて判定する', () => {
    expect(isValidCompanyName('')).toBe(false);
    expect(isValidCompanyName('   ')).toBe(false);
    expect(isValidCompanyName(' A社 ')).toBe(true);
  });

  it('全角12文字まで使える（13文字は使えない）', () => {
    expect(isValidCompanyName('あ'.repeat(MAX_COMPANY_NAME))).toBe(true);
    expect(isValidCompanyName('あ'.repeat(MAX_COMPANY_NAME + 1))).toBe(false);
  });

  it('初期値は既定の社名。同じ社名があれば番号を付ける', () => {
    expect(suggestCompanyName('career', [])).toBe(DEFAULT_COMPANY_NAME);
    expect(suggestCompanyName('career', [save(11, DEFAULT_COMPANY_NAME)])).toBe(`${DEFAULT_COMPANY_NAME} 2`);
    expect(suggestCompanyName('career', [save(11, DEFAULT_COMPANY_NAME), save(12, `${DEFAULT_COMPANY_NAME} 2`)])).toBe(`${DEFAULT_COMPANY_NAME} 3`);
  });

  it('サンドボックスの既定の社名は「サンドボックス」。経営の会社とは数えない', () => {
    expect(suggestCompanyName('sandbox', [save(21, DEFAULT_COMPANY_NAME)])).toBe(DEFAULT_SANDBOX_NAME);
  });

  it('複製の社名は「（コピー）」を付け、同じ名前があれば番号を付ける', () => {
    expect(copyNameOf('A社', [])).toBe('A社（コピー）');
    expect(copyNameOf('A社', [save(11, 'A社（コピー）')])).toBe('A社（コピー） 2');
  });
});

describe('枠の規則', () => {
  it('空いている枠は、遊び方の枠の中で最も小さい番号。経営とサンドボックスは別々に数える', () => {
    expect(freeSlotOf('career', [])).toBe(11);
    expect(freeSlotOf('career', [save(11, 'A'), save(13, 'B')])).toBe(12);
    expect(freeSlotOf('sandbox', [])).toBe(21);
  });

  it('枠が全部埋まっていれば null', () => {
    const full = [11, 12, 13, 14, 15].map((slot) => save(slot, `社${slot}`));
    expect(freeSlotOf('career', full)).toBeNull();
  });

  it('「続きから」は最後に保存した会社。一覧は新しい順', () => {
    const saves = [save(11, 'A', 100), save(12, 'B', 300), save(13, 'C', 200)];
    expect(latestCompany(saves)?.data.name).toBe('B');
    expect(latestCompany([])).toBeNull();
    expect(sortByRecent(saves).map((s) => s.data.name)).toEqual(['B', 'C', 'A']);
  });
});
