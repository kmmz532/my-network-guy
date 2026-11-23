// 挑戦の依頼（クリアの後）。既存のひな形から作った依頼に、条件を1つ足した変化形にする。
// 足す条件は、予算が 30% 減る・期限が半分・スイッチの台数の上限のどれか。報酬は変えない。
import type { Balance, ContractTemplate } from '../data/schema';
import { isPcCategory } from '../data/categories';
import { registries } from '../registry/game';
import { deviceCategory } from '../registry/query';
import { spawnGroupsOf } from './spawn';
import type { Offer } from './template';

export const CHALLENGE_KINDS = ['budget', 'deadline', 'devices'] as const;
export type ChallengeKind = (typeof CHALLENGE_KINDS)[number];

// 上限をかける機器の種類（スイッチ）
const SWITCH = 'l2_switch';

// 1台で最も多くつなげるスイッチの口の数
const largestSwitchPorts = (): number =>
  Math.max(...registries.devices.all().filter((d) => deviceCategory(d.id) === SWITCH).map((d) => d.ports.reduce((s, p) => s + p.count, 0)));

// 最安の設計が使うスイッチの台数の上限（変化形の上限になる。足りなくならないよう、最安の設計の台数以上にする）。
// 固定のスイッチ + 置く範囲ごとのスイッチ（PC と上の機器への1口を収める台数）+ 範囲が2つ以上のときの中継（範囲の数 - 1 台まで）。台数の目標があれば、その数は下回らない
export const switchLimitOf = (offer: Offer, template: ContractTemplate): number => {
  const fixed = (template.placed ?? []).filter((p) => deviceCategory(p.device) === SWITCH).length;
  const groups = spawnGroupsOf(template);
  const largest = largestSwitchPorts();
  const hubs = groups.reduce((sum, g) => {
    const pcs = offer.contract.placed.filter((p) => isPcCategory(deviceCategory(p.device)) && p.x >= g.x && p.x < g.x + g.width && p.y >= g.y && p.y < g.y + g.height).length;
    return sum + Math.max(1, Math.ceil((pcs + 1) / largest));
  }, 0);
  const wanted = template.goals.reduce((sum, g) => {
    if (g.type !== 'count') return sum;
    const { category, min } = g;
    return category === SWITCH ? sum + min : sum;
  }, 0);
  return Math.max(fixed + hubs + Math.max(0, groups.length - 1), fixed + wanted);
};

// 足せる条件の種類。期限のない依頼は、期限を半分にできない
export const challengeKindsOf = (offer: Offer): ChallengeKind[] =>
  CHALLENGE_KINDS.filter((k) => k !== 'deadline' || offer.contract.deadlineDays !== undefined);

// 依頼に条件を1つ足した、挑戦の依頼を作る
export const challengeOf = (offer: Offer, template: ContractTemplate, kind: ChallengeKind, balance: Balance): Offer => {
  const c = offer.contract;
  switch (kind) {
    case 'budget':
      return { ...offer, challenge: kind, contract: { ...c, budget: Math.round(c.budget * balance.challenge.budgetMul) } };
    case 'deadline': {
      if (c.deadlineDays === undefined) throw new Error(`${offer.id}: 期限のない依頼は、期限を半分にできない`);
      return { ...offer, challenge: kind, contract: { ...c, deadlineDays: Math.max(1, Math.round(c.deadlineDays * balance.challenge.deadlineMul)) } };
    }
    case 'devices':
      return { ...offer, challenge: kind, contract: { ...c, goals: [...c.goals, { type: 'max_devices', category: SWITCH, max: switchLimitOf(offer, template) }] } };
  }
};
