import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import c001 from '../assets/data/contracts/c001_direct_link.json';
import c002 from '../assets/data/contracts/c002_small_office.json';
import templateJson from '../assets/data/contracts/templates/t_small_lan.json';
import officeJson from '../assets/data/maps/office_small.json';
import type { Balance, Contract, ContractTemplate, GameMap } from '../data/schema';
import { minutesPerDay } from '../sim/clock';
import { MAX_OFFERS, refreshOffers, type OfferEnv, type OfferState } from './offers';
import { instantiateTemplate, starHubOf } from './template';

const balance = balanceJson as unknown as Balance;
const map = officeJson as unknown as GameMap;
const template = templateJson as unknown as ContractTemplate;
const fixed = [c001, c002] as unknown as Contract[];

// 既存のテストは、1回の追加で1件だけ届く前提（まとめて届く設定は下のテストで確かめる）
const env: OfferEnv = {
  balance: { ...balance, offerBurst: undefined },
  fixed,
  templates: [template],
  mapOf: (id) => (id === map.id ? map : undefined),
};

const start: OfferState = {
  minute: 0,
  reputation: 0,
  completed: [],
  offers: [],
  excluded: [],
  nextOfferMinute: 0,
  offerSeq: 0,
  rng: 42,
};

describe('定型案件の生成', () => {
  it('同じ乱数の状態からは同じ案件になる', () => {
    const a = instantiateTemplate(template, map, 0, 7);
    const b = instantiateTemplate(template, map, 0, 7);
    expect(a).toEqual(b);
  });

  it('台数は範囲内、配置は spawnArea 内の床に重ならない', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { offer } = instantiateTemplate(template, map, 0, seed);
      const n = offer.params.pcCount;
      expect(n).toBeGreaterThanOrEqual(template.params.pcCount.min);
      expect(n).toBeLessThanOrEqual(template.params.pcCount.max);
      expect(offer.contract.placed).toHaveLength(n);
      const seen = new Set<string>();
      for (const p of offer.contract.placed) {
        expect(p.x).toBeGreaterThanOrEqual(template.spawnArea.x);
        expect(p.x).toBeLessThan(template.spawnArea.x + template.spawnArea.width);
        expect(p.y).toBeGreaterThanOrEqual(template.spawnArea.y);
        expect(p.y).toBeLessThan(template.spawnArea.y + template.spawnArea.height);
        expect(map.legend[map.tiles[p.y][p.x]]).toBe('floor');
        seen.add(`${p.x},${p.y}`);
      }
      expect(seen.size).toBe(n);
    }
  });

  it('全PCの相互疎通を達成条件にし、報酬と予算は台数に比例する', () => {
    const { offer } = instantiateTemplate(template, map, 3, 5);
    const n = offer.params.pcCount;
    expect(offer.contract.goals).toEqual([{ type: 'ping_all', nodes: offer.contract.placed.map((p) => p.ref) }]);
    expect(offer.contract.budget).toBe(
      template.budget.base + template.budget.perPc * n + template.budget.perTile * starHubOf(offer.contract.placed, map).tiles,
    );
    expect(offer.contract.reward.money).toBe(template.reward.base + template.reward.perPc * n);
    expect(offer.id).toBe('t_small_lan_3');
  });
});

describe('依頼の追加', () => {
  it('最初の依頼は前提のない固定案件', () => {
    const next = refreshOffers(start, env);
    expect(next.offers.map((o) => o.baseId)).toEqual(['c001_direct_link']);
    expect(next.nextOfferMinute).toBe(balance.offerIntervalDays * minutesPerDay);
  });

  it('間隔の前は何も追加しない', () => {
    const state = { ...start, nextOfferMinute: 100000 };
    expect(refreshOffers(state, env)).toBe(state);
  });

  it('前提を満たすと次の固定案件が届く', () => {
    const state = { ...start, completed: ['c001_direct_link'], nextOfferMinute: 0 };
    const next = refreshOffers(state, env);
    expect(next.offers.map((o) => o.baseId)).toEqual(['c002_small_office']);
  });

  it('評判が足りない間は定型案件を出さない', () => {
    const state = { ...start, completed: ['c001_direct_link', 'c002_small_office'], reputation: 1 };
    expect(refreshOffers(state, env).offers).toEqual([]);
  });

  it('評判を満たすと定型案件が届き、連番が進む', () => {
    const state = { ...start, completed: ['c001_direct_link', 'c002_small_office'], reputation: 2 };
    const next = refreshOffers(state, env);
    expect(next.offers).toHaveLength(1);
    expect(next.offers[0].baseId).toBe('t_small_lan');
    expect(next.offerSeq).toBe(1);
  });

  it('まとめて届く設定で確率が1なら、2件以上が一度に届き、件数の上限を超えない', () => {
    const always: OfferEnv = { ...env, balance: { ...balance, offerBurst: { chance: 1, count: 3 } } as Balance };
    // 固定案件を出し終えた状態（定型案件だけが候補になる）
    const done = { ...start, reputation: 5, completed: ['c001_direct_link', 'c002_small_office'] };
    const next = refreshOffers(done, always);
    expect(next.offers.length).toBeGreaterThanOrEqual(2);
    expect(next.offers.length).toBeLessThanOrEqual(MAX_OFFERS);
  });

  it('まとめて届く確率が0なら、毎回1件だけ届く', () => {
    const never: OfferEnv = { ...env, balance: { ...balance, offerBurst: { chance: 0, count: 3 } } as Balance };
    const done = { ...start, reputation: 5, completed: ['c001_direct_link', 'c002_small_office'] };
    expect(refreshOffers(done, never).offers).toHaveLength(1);
  });

  it('受注中の案件は依頼に出さない', () => {
    const state = { ...start, excluded: ['c001_direct_link'] };
    expect(refreshOffers(state, env).offers.map((o) => o.baseId)).toEqual([]);
  });
});
