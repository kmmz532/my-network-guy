import { describe, expect, it } from 'vitest';
import { toolHintOf, type ToolHintGate } from './toolHint';

const gate: ToolHintGate = { offers: true, companiesStarted: 1, guideOn: true, guideShowing: false };

describe('道具の取り違えの一言', () => {
  it('配線の道具でポートの一覧が出たら、選択の道具を教える', () => {
    expect(toolHintOf('portList', 'wire', [], gate)).toBe('select');
  });

  it('選択の道具で機器が動いたら、配線の道具を教える', () => {
    expect(toolHintOf('dragMove', 'select', [], gate)).toBe('wire');
  });

  it('撤去の道具で機器を片付けたら、元に戻すを教える', () => {
    expect(toolHintOf('removed', 'remove', [], gate)).toBe('undo');
  });

  it('出来事と道具が合わないときは出さない', () => {
    expect(toolHintOf('portList', 'select', [], gate)).toBeNull();
    expect(toolHintOf('dragMove', 'wire', [], gate)).toBeNull();
    expect(toolHintOf('removed', 'select', [], gate)).toBeNull();
  });

  it('種類ごとに1回だけ出す', () => {
    expect(toolHintOf('portList', 'wire', ['select'], gate)).toBeNull();
    expect(toolHintOf('dragMove', 'select', ['select'], gate)).toBe('wire');
  });

  it('2社目以降とサンドボックスでは出さない', () => {
    expect(toolHintOf('portList', 'wire', [], { ...gate, companiesStarted: 2 })).toBeNull();
    expect(toolHintOf('portList', 'wire', [], { ...gate, offers: false })).toBeNull();
  });

  it('案内を出さない設定と、案件の案内の手順を出している間は出さない', () => {
    expect(toolHintOf('portList', 'wire', [], { ...gate, guideOn: false })).toBeNull();
    expect(toolHintOf('portList', 'wire', [], { ...gate, guideShowing: true })).toBeNull();
  });
});
