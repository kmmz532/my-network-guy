// 挑戦の依頼（クリアの後）: クリアした会社だけ、届く依頼の share の割合が、条件を1つ足した変化形になる
import { describe, expect, it } from 'vitest';
import balanceJson from '../../resources/data/balance.json';
import mapJson from '../../resources/data/maps/office_small.json';
import templateJson from '../../resources/data/contracts/templates/t_small_lan.json';
import type { Balance, ContractTemplate, GameMap } from '../data/schema';
import { challengeOf, CHALLENGE_KINDS, switchLimitOf } from './challenge';
import { refreshOffers, type OfferEnv, type OfferState } from './offers';
import { instantiateTemplate } from './template';

const balance = balanceJson as unknown as Balance;
const map = mapJson as unknown as GameMap;
const template = { ...(templateJson as unknown as ContractTemplate), requires: [], unlockLevel: 1 };
const env: OfferEnv = { balance: { ...balance, offerBurst: undefined }, fixed: [], templates: [template], mapOf: (id) => (id === map.id ? map : undefined) };

const arrive = (seed: number, cleared: boolean) => {
  const state: OfferState = { minute: 0, companyExp: 0, completed: [], offers: [], excluded: [], nextOfferMinute: 0, offerSeq: 0, newArrivals: {}, cleared, rng: seed };
  const offer = refreshOffers(state, env).offers[0];
  if (!offer) throw new Error('依頼が届かなかった');
  return offer;
};
const seeds = Array.from({ length: 1000 }, (_, i) => i + 1);

describe('挑戦の依頼の割合', () => {
  it('クリアしていない会社には、挑戦の依頼は届かない', () => {
    expect(seeds.filter((s) => arrive(s, false).challenge !== undefined)).toEqual([]);
  });

  it('クリアした会社では、届く依頼の share の割合が挑戦の依頼になり、3種類の条件がどれも出る', () => {
    const challenges = seeds.map((s) => arrive(s, true).challenge).filter((c) => c !== undefined);
    expect(challenges.length / seeds.length).toBeGreaterThan(balance.challenge.share - 0.06);
    expect(challenges.length / seeds.length).toBeLessThan(balance.challenge.share + 0.06);
    expect(new Set(challenges)).toEqual(new Set(CHALLENGE_KINDS.filter((k) => k !== 'deadline' || template.deadlineDays !== undefined)));
  });
});

describe('挑戦の依頼で足される条件', () => {
  const base = instantiateTemplate(template, map, 0, 7).offer;

  it('予算は 3割減り、ほかは変わらない', () => {
    const c = challengeOf(base, template, 'budget', balance);
    expect(c.contract).toEqual({ ...base.contract, budget: Math.round(base.contract.budget * 0.7) });
    expect(c.challenge).toBe('budget');
  });

  it('期限は半分になり、ほかは変わらない', () => {
    if (base.contract.deadlineDays === undefined) throw new Error('試験のひな形に期限がない');
    const c = challengeOf(base, template, 'deadline', balance);
    expect(c.contract).toEqual({ ...base.contract, deadlineDays: Math.round(base.contract.deadlineDays * 0.5) });
  });

  it('スイッチの台数の上限の条件が1つだけ足され、上限は最安の設計の台数（1台）を下回らない', () => {
    const c = challengeOf(base, template, 'devices', balance);
    expect(c.contract.goals).toHaveLength(base.contract.goals.length + 1);
    const added = c.contract.goals[c.contract.goals.length - 1];
    expect(added).toEqual({ type: 'max_devices', category: 'l2_switch', max: switchLimitOf(base, template) });
    expect(switchLimitOf(base, template)).toBeGreaterThanOrEqual(1);
    expect({ ...c.contract, goals: base.contract.goals }).toEqual(base.contract);
  });
});
