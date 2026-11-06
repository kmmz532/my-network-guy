// 社員に任せる（N70）。任せられない理由と、任せて受注できない場合に状態が変わらないこと
import { beforeEach, describe, expect, it } from 'vitest';
import c001 from '../assets/data/contracts/c001_direct_link.json';
import type { Contract } from '../data/schema';
import type { Offer } from '../contracts/template';
import { delegationReason } from '../sim/project';
import { gameEnv } from '../sim/env';
import { minutesPerDay } from '../sim/clock';
import { EMPTY_FAMILIARITY, familiarKeyOf, type Familiarity } from '../sim/familiar';
import { useGameStore } from './useGameStore';

const contract = c001 as unknown as Contract;
const offer: Offer = { id: 'c001_direct_link', kind: 'fixed', baseId: 'c001_direct_link', params: {}, contract };
const key = familiarKeyOf('fixed', 'c001_direct_link', contract.map);
const st = () => useGameStore.getState();

// 型紙の機器（今回の依頼の配置どおりだが、配線がない＝テストは通らない）
const bareBlueprint = {
  nodes: contract.placed.map((p) => ({
    uid: p.ref,
    device: p.device,
    x: p.x,
    y: p.y,
    locked: p.locked,
    configLocked: false,
    interfaces: [],
    gateway: null,
    routes: [],
    services: [],
  })),
  links: [],
  segments: {},
};

const withFamiliarity = (f: Familiarity) => useGameStore.setState({ offers: [offer], active: [], focus: null, familiarity: f });

describe('社員に任せる（N70）の理由', () => {
  beforeEach(() => withFamiliarity(EMPTY_FAMILIARITY));

  it('3回納品していなければ任せられない', () => {
    expect(delegationReason(st().familiarity, offer, gameEnv)).toBe('delegate.count');
  });

  it('3回納品していても、型紙がなければ任せられない', () => {
    withFamiliarity({ counts: { [key]: 3 }, blueprints: {} });
    expect(delegationReason(st().familiarity, offer, gameEnv)).toBe('delegate.blueprint');
  });

  it('型紙の機器の置き場所が今回の依頼と違えば任せられない', () => {
    const moved = { ...bareBlueprint, nodes: bareBlueprint.nodes.map((n) => ({ ...n, x: n.x + 1 })) };
    withFamiliarity({ counts: { [key]: 3 }, blueprints: { [key]: { stars: 3, design: moved } } });
    expect(delegationReason(st().familiarity, offer, gameEnv)).toBe('delegate.fit');
  });

  it('型紙が写せれば、理由はない', () => {
    withFamiliarity({ counts: { [key]: 3 }, blueprints: { [key]: { stars: 3, design: bareBlueprint } } });
    expect(delegationReason(st().familiarity, offer, gameEnv)).toBeNull();
  });
});

describe('社員に任せて受注する（N70）', () => {
  beforeEach(() => withFamiliarity({ counts: { [key]: 3 }, blueprints: { [key]: { stars: 3, design: bareBlueprint } } }));

  it('型紙のテストが通らなければ受注しない（状態は変わらない）', () => {
    const before = st().active.length;
    const reason = st().acceptDelegated(offer.id, st().staff.map((s) => s.uid));
    expect(reason).toBe('delegate.test');
    expect(st().active.length).toBe(before);
    expect(st().offers.map((o) => o.id)).toEqual([offer.id]);
  });
});

// 型紙に、今回の依頼の機器が1台だけある場合（残りの機器は足して、近くのスイッチにつなぐ）
describe('増えた機器をつないで任せる', () => {
  const onePc = {
    nodes: [bareBlueprint.nodes[0]],
    links: [],
    segments: {},
  };
  const aSwitch = {
    uid: 'sw1',
    device: 'l2_switch_8p',
    x: 6,
    y: 4,
    locked: false,
    configLocked: false,
    interfaces: [],
    gateway: null,
    routes: [],
    services: [],
  };

  it('型紙にスイッチがなければ、増えた機器をつなげないので任せられない', () => {
    withFamiliarity({ counts: { [key]: 3 }, blueprints: { [key]: { stars: 3, design: onePc } } });
    expect(delegationReason(st().familiarity, offer, gameEnv)).toBe('delegate.fit');
  });

  it('型紙に空きのあるスイッチがあれば、増えた機器を足して任せられる', () => {
    const withSwitch = { ...onePc, nodes: [...onePc.nodes, aSwitch] };
    withFamiliarity({ counts: { [key]: 3 }, blueprints: { [key]: { stars: 3, design: withSwitch } } });
    expect(delegationReason(st().familiarity, offer, gameEnv)).toBeNull();
  });
});

// 型紙なしで任せる（結果は乱数で決まる）
describe('型紙なしで任せる', () => {
  it('型紙が写せない依頼は、結果を決めて受注を終える（設計は残らない・★は1か2）', () => {
    const moved = { ...bareBlueprint, nodes: bareBlueprint.nodes.map((n) => ({ ...n, x: n.x + 1 })) };
    withFamiliarity({ counts: { [key]: 3 }, blueprints: { [key]: { stars: 3, design: moved } } });
    const crew = st().staff.map((m) => m.uid);
    const money = st().clock.money;
    const reason = st().delegateBlind(offer.id, crew);
    expect(reason).toBeNull();
    expect(st().offers.map((o) => o.id)).toEqual([]);
    // 施工に入る（時間がかかる）。納品までは結果画面も出さず、お金も動かない
    expect(st().active.map((p) => p.id)).toEqual([offer.id]);
    expect(st().active[0].phase).toBe('build');
    expect(st().active[0].delegated).toBe(true);
    expect(st().lastReport).toBeNull();
    expect(st().clock.money).toBe(money);
  });

  it('施工が終わるまで納品せず、終わったら通知で伝え、結果画面は出さない（レベルアップなし）', () => {
    const moved = { ...bareBlueprint, nodes: bareBlueprint.nodes.map((n) => ({ ...n, x: n.x + 1 })) };
    withFamiliarity({ counts: { [key]: 3 }, blueprints: { [key]: { stars: 3, design: moved } } });
    const crew = st().staff.map((m) => m.uid);
    const money = st().clock.money;
    expect(st().delegateBlind(offer.id, crew)).toBeNull();
    // 勤務時間の10時から、施工が終わるまで進める
    const day = Math.floor(st().clock.minute / minutesPerDay) * minutesPerDay;
    useGameStore.setState({ speed: 1, clock: { ...st().clock, minute: day + 10 * 60 } });
    for (let i = 0; i < 20000 && st().active.length > 0; i++) st().tick();
    expect(st().active.length).toBe(0);
    expect(st().deliveries).toBe(1);
    expect(st().lastReport).toBeNull();
    expect(st().notice?.key).toBe('ui.notice.delegated');
    expect(st().clock.money).not.toBe(money);
  });

  it('型紙が写せるなら、型紙なしでは任せない', () => {
    withFamiliarity({ counts: { [key]: 3 }, blueprints: { [key]: { stars: 3, design: bareBlueprint } } });
    expect(st().delegateBlind(offer.id, st().staff.map((m) => m.uid))).toBe('delegate.blueprint_fits');
  });
});
