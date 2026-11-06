// デバッグの「施工を今すぐ終える」（N54）。受注した c001 を設計し、テストを通して施工を頼み、最後まで進めると検収の結果が出る
import { beforeEach, describe, expect, it } from 'vitest';
import officeJson from '../assets/data/maps/office_small.json';
import c001 from '../assets/data/contracts/c001_direct_link.json';
import type { Contract, GameMap } from '../data/schema';
import type { Offer } from '../contracts/template';
import { useGameStore } from './useGameStore';

const map = officeJson as unknown as GameMap;
const offer: Offer = {
  id: 'c001_direct_link',
  kind: 'fixed',
  baseId: 'c001_direct_link',
  params: {},
  contract: c001 as unknown as Contract,
};
const st = () => useGameStore.getState();

beforeEach(() => {
  const s = st();
  useGameStore.setState({
    clock: { ...s.clock, money: 1_000_000 },
    owned: { pc_basic: 2, l2_switch_8p: 1 },
    offers: [offer],
    active: [],
    focus: null,
    maps: { hq: map, office_small: map },
    histories: {},
    check: null,
    lastError: null,
    lastReport: null,
    showcase: null,
    traces: [],
  });
  expect(st().accept(offer.id, [st().staff[0].uid])).toBeNull();
});

describe('施工を今すぐ終える（デバッグ）', () => {
  it('施工を頼んだあとで最後まで進めると、検収の結果が出る', () => {
    st().connect('pc_a', 'pc_b', 'utp_cat5e');
    st().setIface('pc_a', 0, '192.168.1.10', 24);
    st().setIface('pc_b', 0, '192.168.1.11', 24);
    st().test();
    for (let i = 0; i < 20000 && st().active[0]?.testedOk !== true; i++) st().tick();
    expect(st().active[0]?.testedOk).toBe(true);
    st().setSpeed(1);
    expect(st().requestBuild()).toBeNull();
    st().debugFinishBuild();
    expect(st().lastReport).not.toBeNull();
  });

  it('施工中でなければ、何もしない', () => {
    st().debugFinishBuild();
    expect(st().lastReport).toBeNull();
    expect(st().active).toHaveLength(1);
  });
});
