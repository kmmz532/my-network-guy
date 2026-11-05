import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import certsJson from '../assets/data/certs.json';
import trainingJson from '../assets/data/training.json';
import type { Balance, CertDef, Contract } from '../data/schema';
import type { Offer } from '../contracts/template';
import { minutesPerDay } from './clock';
import { accept, emptyOffice, noEffects, type Core } from './project';
import { initialStaff } from './staff';
import { examPassRate, finishTrainings, startTraining, takeExam, type TrainingEnv } from './training';

const balance = balanceJson as unknown as Balance;
const env: TrainingEnv = {
  balance,
  courses: Object.fromEntries(trainingJson.courses.map((c) => [c.id, c])),
  certs: Object.fromEntries(certsJson.certs.map((c) => [c.id, c as unknown as CertDef])),
};

const core = (): Core => ({
  clock: { minute: 1000, money: 1_000_000, paidMonths: 0, bankrupt: false },
  reputation: 0,
  owned: {},
  completed: [],
  offers: [],
  active: [],
  focus: null,
  office: emptyOffice({ w: 5, h: 5 }),
  effects: noEffects(),
  staff: initialStaff(balance, 1).staff,
  staffSeq: 2,
  candidates: [],
  guidesDone: [],
});

// 社員 s0 を、職種 network・level 3 にする
const network3 = (c: Core): Core => ({
  ...c,
  staff: c.staff.map((s) => (s.uid === 's0' ? { ...s, job: 'network' as const, level: 3 } : s)),
});

const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`失敗: ${(r as { reason?: string }).reason}`);
  return r as Extract<T, { ok: true }>;
};

describe('研修', () => {
  it('研修を受けさせると費用を払い、期日を記録する', () => {
    const r = ok(startTraining(core(), 's0', 'basic', env));
    expect(r.core.clock.money).toBe(1_000_000 - 100000);
    expect(r.core.staff[0].training).toEqual({ course: 'basic', untilMinute: 1000 + 5 * minutesPerDay });
  });

  it('研修中の社員は、担当に選べない（crew）', () => {
    const trained = ok(startTraining(core(), 's0', 'basic', env)).core;
    const contract: Contract = {
      id: 'x',
      stage: 1,
      order: 0,
      requires: [],
      map: 'office_small',
      budget: 0,
      placed: [],
      goals: [{ type: 'count', category: 'pc', min: 1 }],
      reward: { money: 0, reputation: 0 },
      inhouse: false,
    };
    const offer: Offer = { id: 'x', kind: 'fixed', baseId: 'x', params: {}, contract };
    const withOffer: Core = { ...trained, offers: [offer] };
    expect(accept(withOffer, 'x', 1, ['s0'])).toEqual({ ok: false, reason: 'crew' });
  });

  it('期日に経験値を与え、研修を終える', () => {
    const trained = ok(startTraining(core(), 's0', 'basic', env)).core;
    const before = { ...trained, clock: { ...trained.clock, minute: trained.clock.minute + 5 * minutesPerDay - 1 } };
    expect(finishTrainings(before, env).staff[0].training).not.toBeNull();
    const after = { ...trained, clock: { ...trained.clock, minute: trained.clock.minute + 5 * minutesPerDay } };
    const done = finishTrainings(after, env).staff[0];
    expect(done.training).toBeNull();
    // 150 の経験値で level 1 → 2（100 で上がり、余り 50）
    expect(done.level).toBe(2);
    expect(done.exp).toBe(50);
  });
});

describe('資格の受験', () => {
  it('合格率は level で決まり、0.9 を上限にする', () => {
    expect(examPassRate(3, 3, balance)).toBeCloseTo(0.4);
    expect(examPassRate(4, 3, balance)).toBeCloseTo(0.5);
    expect(examPassRate(20, 3, balance)).toBe(0.9);
  });

  it('合格すると資格を得て、level が1上がる。受験料はかかる', () => {
    const r = ok(takeExam(network3(core()), 's0', 'net1', 0.1, env));
    expect(r.core.staff[0].certs).toEqual(['net1']);
    expect(r.core.staff[0].level).toBe(4);
    expect(r.core.clock.money).toBe(1_000_000 - 50000);
  });

  it('不合格なら資格も level も変わらず、受験料だけかかる', () => {
    const r = ok(takeExam(network3(core()), 's0', 'net1', 0.9, env));
    expect(r.core.staff[0].certs).toEqual([]);
    expect(r.core.staff[0].level).toBe(3);
    expect(r.core.clock.money).toBe(1_000_000 - 50000);
  });

  it('職種が違う、level が足りない場合は受験できない', () => {
    expect(takeExam(core(), 's0', 'sec1', 0, env)).toEqual({ ok: false, reason: 'job' });
    expect(takeExam(core(), 's0', 'net1', 0, env)).toEqual({ ok: false, reason: 'level' });
  });
});
