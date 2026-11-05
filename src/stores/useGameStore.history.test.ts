// 設計の取り消し・やり直し（ストアと、キーの処理）。案件と自社オフィスの両方を確かめる
import { beforeEach, describe, expect, it } from 'vitest';
import officeJson from '../assets/data/maps/office_small.json';
import c001 from '../assets/data/contracts/c001_direct_link.json';
import type { Contract, GameMap } from '../data/schema';
import type { Offer } from '../contracts/template';
import { handleKey, type UiActions } from '../input/keymap';
import { projectHistoryKey } from '../sim/history';
import { useGameStore } from './useGameStore';

const map = officeJson as unknown as GameMap;
const offer: Offer = {
  id: 'c001_direct_link',
  kind: 'fixed',
  baseId: 'c001_direct_link',
  params: {},
  contract: c001 as unknown as Contract,
};
const ui: UiActions = { togglePopup: () => {}, toggleWarehouse: () => {} };
const st = () => useGameStore.getState();

// 自社オフィスで、机2つ（(3,4) と (8,4)）と在庫を用意する
const resetOffice = () => {
  const s = st();
  useGameStore.setState({
    clock: { ...s.clock, money: 1_000_000 },
    owned: { pc_basic: 2, l2_switch_8p: 1 },
    active: [],
    focus: null,
    office: {
      ...s.office,
      nodes: [],
      links: [],
      seq: 0,
      segments: {},
      furniture: [
        { uid: 'f3_4', id: 'desk', x: 3, y: 4 },
        { uid: 'f8_4', id: 'desk', x: 8, y: 4 },
      ],
      furnitureSeq: 2,
    },
    maps: { hq: map, office_small: map },
    histories: {},
    check: null,
    lastError: null,
  });
};

// c001（PC2台の直結）を受注し、設計の対象にする
const resetProject = () => {
  const s = st();
  useGameStore.setState({
    clock: { ...s.clock, money: 1_000_000 },
    offers: [offer],
    active: [],
    focus: null,
    histories: {},
    check: null,
    lastError: null,
  });
  const crew = [st().staff[0].uid];
  expect(st().accept(offer.id, crew)).toBeNull();
};

describe('自社オフィスの取り消し・やり直し', () => {
  beforeEach(resetOffice);

  it('配置して元に戻すと機器が消え、資金と在庫も戻る', () => {
    const money = st().clock.money;
    expect(st().place('l2_switch_8p', 6, 6)).toBeNull();
    expect(st().office.nodes).toHaveLength(1);
    expect(st().owned.l2_switch_8p).toBe(0);

    st().undo();
    expect(st().office.nodes).toHaveLength(0);
    expect(st().owned.l2_switch_8p).toBe(1);
    expect(st().clock.money).toBe(money);
  });

  it('元に戻したあと、やり直すと機器が戻る', () => {
    st().place('l2_switch_8p', 6, 6);
    st().undo();
    st().redo();
    expect(st().office.nodes.map((n) => [n.x, n.y])).toEqual([[6, 6]]);
    expect(st().owned.l2_switch_8p).toBe(0);
  });

  it('戻したあとに新しい操作をすると、やり直しの履歴は消える', () => {
    st().place('l2_switch_8p', 6, 6);
    st().undo();
    expect(st().histories.office.future).toHaveLength(1);
    st().place('l2_switch_8p', 7, 6);
    expect(st().histories.office.future).toHaveLength(0);
    st().redo();
    expect(st().office.nodes.map((n) => [n.x, n.y])).toEqual([[7, 6]]);
  });

  it('配線の費用も、元に戻すと資金に戻る', () => {
    st().place('pc_basic', 3, 4);
    st().place('pc_basic', 8, 4);
    const before = st().clock.money;
    expect(st().connect('u0', 'u1', 'utp_cat5e')).toBeNull();
    expect(st().clock.money).toBeLessThan(before);
    expect(st().office.links).toHaveLength(1);

    st().undo();
    expect(st().office.links).toHaveLength(0);
    expect(st().clock.money).toBe(before);
  });

  it('操作が失敗したときは、履歴に積まれない', () => {
    expect(st().place('l2_switch_8p', 0, 0)).toBe('tile');
    expect(st().histories.office).toBeUndefined();
  });

  it('50件を超えると、古いものから消える', () => {
    st().place('pc_basic', 3, 4);
    for (let i = 0; i < 55; i++) st().setService('u0', 'http', i % 2 === 0);
    expect(st().histories.office.past).toHaveLength(50);
  });

  it('Ctrl+Z と Ctrl+Y（Ctrl+Shift+Z）で戻す・やり直す', () => {
    st().place('l2_switch_8p', 6, 6);
    const key = (k: string, shiftKey = false) =>
      handleKey({ key: k, ctrlKey: true, metaKey: false, shiftKey, altKey: false, target: null }, ui);
    expect(key('z')).toBe(true);
    expect(st().office.nodes).toHaveLength(0);
    // Ctrl+Shift+Z もやり直す
    expect(key('z', true)).toBe(true);
    expect(st().office.nodes).toHaveLength(1);
    expect(key('z')).toBe(true);
    expect(st().office.nodes).toHaveLength(0);
    expect(key('y')).toBe(true);
    expect(st().office.nodes).toHaveLength(1);
  });

  it('入力欄にいるときは、Ctrl+Z をブラウザに任せる', () => {
    st().place('l2_switch_8p', 6, 6);
    const handled = handleKey(
      { key: 'z', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, target: { tagName: 'INPUT', isContentEditable: false } as unknown as EventTarget },
      ui,
    );
    expect(handled).toBe(false);
    expect(st().office.nodes).toHaveLength(1);
  });
});

describe('案件の取り消し・やり直し', () => {
  beforeEach(resetProject);

  it('IPアドレスの設定を元に戻すと、設定がなくなる', () => {
    expect(st().setIface('pc_a', 0, '192.168.1.10')).toBeNull();
    expect(st().histories[projectHistoryKey('c001_direct_link')].past).toHaveLength(1);
    st().undo();
    const pcA = st().active[0].nodes.find((n) => n.uid === 'pc_a');
    expect(pcA?.interfaces).toEqual([]);
  });

  it('テストに合格したあとに戻すと、テストの合否は false になる', () => {
    st().setIface('pc_a', 0, '192.168.1.10');
    st().setIface('pc_b', 0, '192.168.1.11');
    expect(st().connect('pc_a', 'pc_b', 'utp_cat5e')).toBeNull();
    expect(st().clock.money).toBeLessThan(1_000_000);
    expect(st().test()).toBeNull();
    expect(st().active[0].testedOk).toBe(true);
    // 配線を戻すと、配線の費用も資金に戻り、テストの合否は false になる
    st().undo();
    expect(st().active[0].testedOk).toBe(false);
    expect(st().active[0].links).toHaveLength(0);
    expect(st().clock.money).toBe(1_000_000);
  });

  it('施工を依頼すると、その案件の履歴は消える', () => {
    st().setIface('pc_a', 0, '192.168.1.10');
    st().setIface('pc_b', 0, '192.168.1.11');
    st().connect('pc_a', 'pc_b', 'utp_cat5e');
    expect(st().test()).toBeNull();
    expect(st().requestBuild()).toBeNull();
    expect(st().active[0].phase).toBe('build');
    expect(st().histories[projectHistoryKey('c001_direct_link')]).toBeUndefined();
    // 施工後は、戻す操作がない
    st().undo();
    expect(st().active[0].phase).toBe('build');
  });

  it('自社案件を受注すると、自社オフィスの履歴は消える', () => {
    resetOffice();
    st().place('l2_switch_8p', 6, 6);
    expect(st().histories.office.past).toHaveLength(1);
    useGameStore.setState({ offers: [{ ...offer, id: 'inhouse_test', contract: { ...offer.contract, inhouse: true } }] });
    expect(st().accept('inhouse_test', [st().staff[0].uid])).toBeNull();
    expect(st().histories.office).toBeUndefined();
  });
});

describe('資金と在庫の差分（全体の値は戻さない）', () => {
  beforeEach(resetOffice);

  it('配線のあとに給与を払い、元に戻すと、給与の分は戻らず配線費だけが返る', () => {
    st().place('pc_basic', 3, 4);
    st().place('pc_basic', 8, 4);
    const before = st().clock.money;
    expect(st().connect('u0', 'u1', 'utp_cat5e')).toBeNull();
    // 給与の支払い（月末に資金が減る）を、配線の後に起きたこととして再現する
    useGameStore.setState({ clock: { ...st().clock, money: st().clock.money - 5000 } });

    st().undo();
    expect(st().office.links).toHaveLength(0);
    expect(st().clock.money).toBe(before - 5000);
  });

  it('案件Aで配線し、案件Bで配線したあとにAを戻しても、Bの配線費は残る', () => {
    // 受注の枠は1件のため、Bは受注せず、Aの写しを同時に設計中の案件として置く
    useGameStore.setState({ offers: [offer], clock: { ...st().clock, money: 1_000_000 } });
    expect(st().accept(offer.id, [st().staff[0].uid])).toBeNull();
    const before = st().clock.money;
    expect(st().connect('pc_a', 'pc_b', 'utp_cat5e')).toBeNull();
    const costA = before - st().clock.money;
    expect(costA).toBeGreaterThan(0);

    const a = st().active[0];
    useGameStore.setState({ active: [...st().active, { ...a, id: 'case_b', links: [], cost: 0 }], focus: 'case_b' });
    const mid = st().clock.money;
    expect(st().connect('pc_a', 'pc_b', 'utp_cat5e')).toBeNull();
    const costB = mid - st().clock.money;
    expect(costB).toBeGreaterThan(0);

    // 案件Aに戻して、Aの配線を取り消す。Bの配線費は残る
    useGameStore.setState({ focus: offer.id });
    st().undo();
    expect(st().active.find((p) => p.id === offer.id)!.links).toHaveLength(0);
    expect(st().active.find((p) => p.id === 'case_b')!.links).toHaveLength(1);
    expect(st().clock.money).toBe(before - costB);
  });

  it('ショップで購入し、配置して戻すと、在庫が1つ戻り、資金は購入の分のまま', () => {
    useGameStore.setState({ owned: {} });
    const before = st().clock.money;
    expect(st().buy('l2_switch_8p')).toBe(true);
    const afterBuy = st().clock.money;
    expect(afterBuy).toBeLessThan(before);
    expect(st().owned.l2_switch_8p).toBe(1);

    expect(st().place('l2_switch_8p', 6, 6)).toBeNull();
    expect(st().owned.l2_switch_8p).toBe(0);
    st().undo();
    expect(st().owned.l2_switch_8p).toBe(1);
    expect(st().clock.money).toBe(afterBuy);
    expect(st().office.nodes).toHaveLength(0);
  });

  it('撤去を戻すとき在庫がもう無ければ、戻さずに失敗し、理由を残す', () => {
    st().place('l2_switch_8p', 6, 6);
    expect(st().removeNode('u0')).toBeNull();
    expect(st().owned.l2_switch_8p).toBe(1);
    // 撤去したあとに、同じ機器を別の場所に置いて在庫が0になった状態（ほかの場所の操作）
    useGameStore.setState({ owned: { ...st().owned, l2_switch_8p: 0 } });

    st().undo();
    expect(st().historyError).toBe('undo');
    expect(st().office.nodes).toHaveLength(0);
    expect(st().owned.l2_switch_8p).toBe(0);
    // 失敗しても履歴は残り、在庫が戻れば、もう一度戻せる
    expect(st().histories.office.past).toHaveLength(2);
    useGameStore.setState({ owned: { ...st().owned, l2_switch_8p: 1 } });
    st().undo();
    expect(st().historyError).toBeNull();
    expect(st().office.nodes).toHaveLength(1);
  });
});
