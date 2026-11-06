// 社員に任せる（N70）。任せられない理由と、任せて受注できない場合に状態が変わらないこと
import { beforeEach, describe, expect, it } from 'vitest';
import c001 from '../assets/data/contracts/c001_direct_link.json';
import type { Contract } from '../data/schema';
import type { Offer } from '../contracts/template';
import { delegationReason } from '../sim/project';
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
    expect(delegationReason(st().familiarity, offer)).toBe('delegate.count');
  });

  it('3回納品していても、型紙がなければ任せられない', () => {
    withFamiliarity({ counts: { [key]: 3 }, blueprints: {} });
    expect(delegationReason(st().familiarity, offer)).toBe('delegate.blueprint');
  });

  it('型紙の機器の置き場所が今回の依頼と違えば任せられない', () => {
    const moved = { ...bareBlueprint, nodes: bareBlueprint.nodes.map((n) => ({ ...n, x: n.x + 1 })) };
    withFamiliarity({ counts: { [key]: 3 }, blueprints: { [key]: { stars: 3, design: moved } } });
    expect(delegationReason(st().familiarity, offer)).toBe('delegate.fit');
  });

  it('型紙が写せれば、理由はない', () => {
    withFamiliarity({ counts: { [key]: 3 }, blueprints: { [key]: { stars: 3, design: bareBlueprint } } });
    expect(delegationReason(st().familiarity, offer)).toBeNull();
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
