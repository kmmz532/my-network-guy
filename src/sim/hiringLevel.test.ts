// 会社のレベルによる採用（N45・LEVEL.md 3.3）。解放された職種だけが候補に出る。人数の上限に達すると採用できない
import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import type { Balance } from '../data/schema';
import { hire } from './furniture';
import { rollCandidates, staffCapOf, unlockedJobsOf } from './staff';

const balance = balanceJson as unknown as Balance;

describe('会社のレベルによる採用', () => {
  it('職種は、解放のレベルに届いたものだけ（Lv1 はネットワークだけ、Lv5 でインフラ）', () => {
    expect(unlockedJobsOf(1, balance)).toEqual([]);
    expect(unlockedJobsOf(2, balance)).toEqual(['network']);
    expect(unlockedJobsOf(5, balance)).toEqual(['network', 'infra']);
  });

  it('人数の上限は、会社のレベル以上での最も新しい上限', () => {
    expect(staffCapOf(1, balance)).toBe(2);
    expect(staffCapOf(4, balance)).toBe(4);
    expect(staffCapOf(9, balance)).toBe(6);
  });

  it('候補の職種は、解放された職種からだけ選ばれる', () => {
    for (let seed = 1; seed < 300; seed += 13) {
      expect(rollCandidates(1, 1, seed, balance).candidates).toEqual([]);
      for (const c of rollCandidates(2, 1, seed, balance).candidates) expect(c.job).toBe('network');
    }
  });

  it('人数が上限に達していれば採用できない（cap）', () => {
    const candidate = { uid: 'c1_0', name: 'staff.name.0', look: 'blue', quirk: 'q1', job: 'network', level: 1, exp: 0, salary: 1, certs: [], training: null };
    const core = {
      staff: [candidate, candidate],
      staffSeq: 2,
      candidates: [{ ...candidate, uid: 'c1_1' }],
      office: { furniture: [{ uid: 'f0', id: 'desk', x: 1, y: 1 }, { uid: 'f1', id: 'desk', x: 2, y: 1 }, { uid: 'f2', id: 'desk', x: 3, y: 1 }] },
    } as never;
    const r = hire(core, 'c1_1', (id) => id === 'desk', 2);
    expect(r).toEqual({ ok: false, reason: 'cap' });
  });
});
