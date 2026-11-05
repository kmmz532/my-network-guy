import { describe, expect, it } from 'vitest';
import { filterOptions, listHeight, moveActive, pickOnCommit, placeAbove, type ComboOption } from './addressCombo';

const free = (value: string): ComboOption => ({ value, usedBy: null });
const used = (value: string, name: string): ComboOption => ({ value, usedBy: name });

const LIST = [free('192.168.1.1'), used('192.168.1.2', 'PC A LAN'), free('192.168.1.3'), free('192.168.2.1'), used('192.168.1.5', 'PC B LAN')];

describe('filterOptions', () => {
  it('空の文字なら全部の候補を返す', () => {
    expect(filterOptions(LIST, '')).toEqual(LIST);
    expect(filterOptions(LIST, '   ')).toEqual(LIST);
  });

  it('打った文字で始まる候補だけに絞る', () => {
    expect(filterOptions(LIST, '192.168.1.').map((o) => o.value)).toEqual(['192.168.1.1', '192.168.1.2', '192.168.1.3', '192.168.1.5']);
    expect(filterOptions(LIST, '192.168.2').map((o) => o.value)).toEqual(['192.168.2.1']);
  });

  it('途中の一致では絞らない', () => {
    expect(filterOptions(LIST, '168.1.3')).toEqual([]);
  });

  it('使用中の候補も残す（選べないことは moveActive で扱う）', () => {
    expect(filterOptions(LIST, '192.168.1.2')).toEqual([used('192.168.1.2', 'PC A LAN')]);
  });
});

describe('moveActive', () => {
  it('候補がなければ null', () => {
    expect(moveActive([], null, 1)).toBeNull();
    expect(moveActive([], 0, -1)).toBeNull();
  });

  it('強調がないとき、下キーは先頭の選べる候補、上キーは末尾の選べる候補', () => {
    expect(moveActive(LIST, null, 1)).toBe(0);
    expect(moveActive(LIST, null, -1)).toBe(3);
  });

  it('使用中の候補を飛ばす', () => {
    expect(moveActive(LIST, 0, 1)).toBe(2);
    expect(moveActive(LIST, 2, -1)).toBe(0);
  });

  it('末尾から下へ進むと先頭へ回り、先頭から上へ戻ると末尾へ回る', () => {
    expect(moveActive(LIST, 3, 1)).toBe(0);
    expect(moveActive(LIST, 0, -1)).toBe(3);
  });

  it('選べる候補が1つもなければ null', () => {
    const all = [used('192.168.1.1', 'PC A LAN'), used('192.168.1.2', 'PC B LAN')];
    expect(moveActive(all, null, 1)).toBeNull();
    expect(moveActive(all, 0, -1)).toBeNull();
  });

  it('選べる候補が1つだけなら、動かしても同じ候補', () => {
    const one = [used('192.168.1.1', 'PC A LAN'), free('192.168.1.2')];
    expect(moveActive(one, 1, 1)).toBe(1);
    expect(moveActive(one, 1, -1)).toBe(1);
  });
});

describe('pickOnCommit', () => {
  it('候補を強調していれば、その候補の値を確定する', () => {
    expect(pickOnCommit('192.168.1', free('192.168.1.1'))).toBe('192.168.1.1');
  });

  it('候補を選んでいなければ、打った値を確定する（前後の空白は除く）', () => {
    expect(pickOnCommit('  192.168.1.20 ', null)).toBe('192.168.1.20');
  });
});

describe('listHeight', () => {
  it('件数に応じて高さを決め、上限で止める', () => {
    expect(listHeight(0, 22, 220)).toBe(2);
    expect(listHeight(3, 22, 220)).toBe(68);
    expect(listHeight(100, 22, 220)).toBe(220);
  });
});

describe('placeAbove', () => {
  it('下に空きがあれば下に開く', () => {
    expect(placeAbove(300, 100, 200)).toBe(false);
  });

  it('下が足りず、上の方が広ければ上に開く', () => {
    expect(placeAbove(50, 400, 200)).toBe(true);
  });

  it('下も上も足りないときは、空きの広い方（下）に開く', () => {
    expect(placeAbove(100, 80, 200)).toBe(false);
  });
});
