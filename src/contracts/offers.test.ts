import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import c001 from '../assets/data/contracts/c001_direct_link.json';
import c002 from '../assets/data/contracts/c002_small_office.json';
import templateJson from '../assets/data/contracts/templates/t_small_lan.json';
import officeJson from '../assets/data/maps/office_small.json';
import type { Balance, Contract, ContractTemplate, GameMap } from '../data/schema';
import { minutesPerDay } from '../sim/clock';
import { expAtLevel } from '../sim/level';
import { declineOffer, MAX_OFFERS, offerHint, refreshOffers, sortOffers, type OfferEnv, type OfferState } from './offers';
import { instantiateTemplate, pcCountRangeOf, spawnGroupsOf, starHubOf } from './template';

const area = spawnGroupsOf(templateJson as unknown as ContractTemplate)[0];

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
  companyExp: 0,
  completed: [],
  offers: [],
  excluded: [],
  nextOfferMinute: 0,
  offerSeq: 0,
  newArrivals: {},
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
      const range = pcCountRangeOf(template);
      expect(n).toBeGreaterThanOrEqual(range.min);
      expect(n).toBeLessThanOrEqual(range.max);
      expect(offer.contract.placed).toHaveLength(n);
      const seen = new Set<string>();
      for (const p of offer.contract.placed) {
        expect(p.x).toBeGreaterThanOrEqual(area.x);
        expect(p.x).toBeLessThan(area.x + area.width);
        expect(p.y).toBeGreaterThanOrEqual(area.y);
        expect(p.y).toBeLessThan(area.y + area.height);
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
    // c002 は Lv2 から届く。Lv2 に必要な経験値を持たせる
    const state = { ...start, completed: ['c001_direct_link'], nextOfferMinute: 0, companyExp: expAtLevel(2, balance) };
    const next = refreshOffers(state, env);
    expect(next.offers.map((o) => o.baseId)).toEqual(['c002_small_office']);
  });

  it('レベルが足りない間は定型案件を出さない', () => {
    const lockedEnv = { ...env, templates: [{ ...template, unlockLevel: 5 }] };
    const state = { ...start, completed: ['c001_direct_link', 'c002_small_office'], companyExp: 1 };
    expect(refreshOffers(state, lockedEnv).offers).toEqual([]);
  });

  it('レベルを満たすと定型案件が届き、連番が進む', () => {
    const state = { ...start, completed: ['c001_direct_link', 'c002_small_office'], companyExp: expAtLevel(2, balance) };
    const next = refreshOffers(state, env);
    expect(next.offers).toHaveLength(1);
    expect(next.offers[0].baseId).toBe('t_small_lan');
    expect(next.offerSeq).toBe(1);
  });

  it('まとめて届く設定で確率が1なら、2件以上が一度に届き、件数の上限を超えない', () => {
    const always: OfferEnv = { ...env, balance: { ...balance, offerBurst: { chance: 1, count: 3 } } as Balance };
    // 固定案件を出し終えた状態（定型案件だけが候補になる）
    const done = { ...start, companyExp: 5, completed: ['c001_direct_link', 'c002_small_office'] };
    const next = refreshOffers(done, always);
    expect(next.offers.length).toBeGreaterThanOrEqual(2);
    expect(next.offers.length).toBeLessThanOrEqual(MAX_OFFERS);
  });

  it('まとめて届く確率が0なら、毎回1件だけ届く', () => {
    const never: OfferEnv = { ...env, balance: { ...balance, offerBurst: { chance: 0, count: 3 } } as Balance };
    const done = { ...start, companyExp: 5, completed: ['c001_direct_link', 'c002_small_office'] };
    expect(refreshOffers(done, never).offers).toHaveLength(1);
  });

  it('受注中の案件は依頼に出さない', () => {
    const state = { ...start, excluded: ['c001_direct_link'] };
    expect(refreshOffers(state, env).offers.map((o) => o.baseId)).toEqual([]);
  });
});

describe('次の依頼の案内（offerHint）', () => {
  it('次の依頼までの日数を出す（1日未満は1日）', () => {
    expect(offerHint({ ...start, nextOfferMinute: 2 * minutesPerDay }, env).days).toBe(2);
    expect(offerHint({ ...start, nextOfferMinute: 10 }, env).days).toBe(1);
  });

  it('届く見込みがあれば理由は出さない', () => {
    expect(offerHint(start, env).block).toBeNull();
  });

  it('依頼が上限までたまっていても、新しい依頼は届く（古いものから消す）', () => {
    const offers = Array.from({ length: MAX_OFFERS }, (_, i) => ({ id: `x${i}`, kind: 'template' as const, baseId: `x${i}`, params: {}, contract: fixed[0] }));
    expect(offerHint({ ...start, offers: offers as OfferState['offers'] }, env).block).toBeNull();
  });

  it('上限を超える依頼は、古いものから消して最大 MAX_OFFERS 件に保つ', () => {
    const offers = Array.from({ length: MAX_OFFERS }, (_, i) => ({ id: `old${i}`, kind: 'template' as const, baseId: `old${i}`, params: {}, contract: fixed[0] }));
    const out = refreshOffers({ ...start, minute: 0, nextOfferMinute: 0, offers: offers as OfferState['offers'] }, { ...env, balance: { ...env.balance, offerBurst: undefined } });
    expect(out.offers.length).toBe(MAX_OFFERS);
    expect(out.offers[0].id).toBe('old1');
  });

  it('レベルが足りないときは必要なレベルを出す', () => {
    const high = { ...env, templates: [{ ...template, unlockLevel: 5 }] };
    expect(offerHint({ ...start, completed: ['c002_small_office'], companyExp: 0 }, { ...high, fixed: [] }).block).toEqual({ kind: 'level', need: 5 });
  });

  it('固定案件の前提が未達のときは、最初の前提を出す', () => {
    const noTemplate = { ...env, templates: [], fixed: [{ ...c002, requires: ['c001_direct_link'] }] as unknown as Contract[] };
    expect(offerHint({ ...start, completed: [] }, noTemplate).block).toEqual({ kind: 'fixed', after: 'c001_direct_link' });
  });
});

describe('依頼の届いた日・期限・並べ替え・断る（N39）', () => {
  it('定型案件には届いた時刻と、ひな形の範囲の受注期限が付く', () => {
    const minute = 5 * minutesPerDay;
    const out = refreshOffers({ ...start, minute, nextOfferMinute: minute, completed: ['c001_direct_link', 'c002_small_office'], companyExp: 5 }, env);
    const o = out.offers.find((x) => x.kind === 'template');
    expect(o?.arrivedMinute).toBe(minute);
    const days = ((o?.expiresMinute ?? 0) - minute) / minutesPerDay;
    expect(days).toBeGreaterThanOrEqual(30);
    expect(days).toBeLessThanOrEqual(90);
  });

  it('受注期限を過ぎた定型案件は、次の判定で消える', () => {
    const offers = [{ id: 'old', kind: 'template' as const, baseId: 't_small_lan', params: {}, contract: fixed[0], arrivedMinute: 0, expiresMinute: 10 }];
    const out = refreshOffers({ ...start, minute: 11, nextOfferMinute: 1e9, offers: offers as OfferState['offers'] }, env);
    expect(out.offers.some((o) => o.id === 'old')).toBe(false);
  });

  it('並べ替え: 新しい順・期限の近い順（期限なしは後ろ）・報酬の高い順', () => {
    const mk = (id: string, arrived: number, expires: number | undefined, money: number) =>
      ({ id, kind: 'template' as const, baseId: id, params: {}, arrivedMinute: arrived, expiresMinute: expires, contract: { ...fixed[0], reward: { money, companyExp: 0 } } }) as unknown as OfferState['offers'][number];
    const list = [mk('a', 1, 50, 100), mk('b', 3, undefined, 300), mk('c', 2, 20, 200)];
    expect(sortOffers(list, 'new').map((o) => o.id)).toEqual(['b', 'c', 'a']);
    expect(sortOffers(list, 'deadline').map((o) => o.id)).toEqual(['c', 'a', 'b']);
    expect(sortOffers(list, 'reward').map((o) => o.id)).toEqual(['b', 'c', 'a']);
  });

  it('断るは定型案件だけ消す（固定案件は残す）', () => {
    const list = [
      { id: 'fx', kind: 'fixed' as const, baseId: 'fx', params: {}, contract: fixed[0] },
      { id: 'tp', kind: 'template' as const, baseId: 'tp', params: {}, contract: fixed[0] },
    ] as OfferState['offers'];
    expect(declineOffer(list, 'tp').map((o) => o.id)).toEqual(['fx']);
    expect(declineOffer(list, 'fx').map((o) => o.id)).toEqual(['fx', 'tp']);
  });
});
