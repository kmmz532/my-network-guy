// 募集の職種の指定（人事）: 候補の半分以上（切り上げ）が指定した職種になる
import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import type { Balance } from '../data/schema';
import { rollCandidates } from './staff';

const balance = balanceJson as unknown as Balance;
// 会社のレベル 10（すべての職種が解放されている）
const LEVEL = 10;

describe('募集の職種の指定', () => {
  it('指定した職種は、候補の半分以上（切り上げ）になる', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const r = rollCandidates(LEVEL, 1, seed, balance, [], { extraCount: 0, levelBonus: 0, wish: 'accounting' });
      const wished = r.candidates.filter((c) => c.job === 'accounting').length;
      expect(wished).toBeGreaterThanOrEqual(Math.ceil(r.candidates.length / 2));
    }
  });

  it('指定がなければ、今までどおり（候補の職種は指定の影響を受けない）', () => {
    const plain = rollCandidates(LEVEL, 1, 7, balance, []);
    const same = rollCandidates(LEVEL, 1, 7, balance, [], { extraCount: 0, levelBonus: 0 });
    expect(plain.candidates.map((c) => c.job)).toEqual(same.candidates.map((c) => c.job));
  });
});
