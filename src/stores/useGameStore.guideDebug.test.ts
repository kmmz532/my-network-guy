// デバッグの案内の操作（N54）。手順から始める（受注して設計に入り、指定の手順を出す）・受注できないときは何も変えない・済みにするは経験値を増やさない
import { beforeEach, describe, expect, it } from 'vitest';
import officeJson from '../assets/data/maps/office_small.json';
import type { GameMap } from '../data/schema';
import { useGameStore } from './useGameStore';

const map = officeJson as unknown as GameMap;
const st = () => useGameStore.getState();
const C = 'c001_direct_link';
const initialStaff = st().staff;

beforeEach(() => {
  const s = st();
  useGameStore.setState({
    clock: { ...s.clock, money: 1_000_000 },
    offers: [],
    active: [],
    focus: null,
    maps: { hq: map, office_small: map },
    histories: {},
    check: null,
    lastError: null,
    guidesDone: [],
    debugGuide: null,
    staff: initialStaff,
  });
});

describe('案内の開始（デバッグ）', () => {
  it('未受注の案件でも、受注して設計に入り、指定の手順を出す指定が残る', () => {
    expect(st().debugStartGuide(C, 2)).toBeNull();
    const focused = st().active[0];
    expect(focused?.baseId).toBe(C);
    expect(focused?.phase).toBe('design');
    expect(st().guidesDone).not.toContain(C);
    expect(st().debugGuide).toEqual({ id: C, step: 2 });
  });

  it('受注できないとき（空いている社員がいない）は理由を返し、何も変えない', () => {
    useGameStore.setState({ staff: [] });
    const before = { offers: st().offers, active: st().active, guidesDone: st().guidesDone };
    expect(st().debugStartGuide(C, 1)).toBe('crew');
    expect(st().offers).toEqual(before.offers);
    expect(st().active).toEqual(before.active);
    expect(st().guidesDone).toEqual(before.guidesDone);
    expect(st().debugGuide).toBeNull();
  });

  it('手順の番号が範囲の外・案件がないときは、何も変えない', () => {
    expect(st().debugStartGuide(C, 99)).toBe('none');
    expect(st().debugStartGuide('no_such_contract', 1)).toBe('none');
    expect(st().active).toHaveLength(0);
    expect(st().debugGuide).toBeNull();
  });

  it('終わった案内を、指定の手順から出し直すと、済みの印を外す', () => {
    useGameStore.setState({ guidesDone: [C] });
    expect(st().debugStartGuide(C, 1)).toBeNull();
    expect(st().guidesDone).not.toContain(C);
  });
});

describe('案内を済みにする（デバッグ）', () => {
  it('済みの印を付け、経験値は増やさない', () => {
    const exp = st().companyExp;
    st().debugMarkGuideDone(C);
    expect(st().guidesDone).toContain(C);
    expect(st().companyExp).toBe(exp);
  });
});
