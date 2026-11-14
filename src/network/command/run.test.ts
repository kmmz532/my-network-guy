import { describe, expect, it } from 'vitest';
import { isConfigLine } from './run';
import type { TerminalSession } from './types';

const exec: TerminalSession = { mode: 'exec', iface: null, process: null };
const tr = (key: string) => key;

describe('読み取り専用の機器が先に拒否する行', () => {
  it('存在しない経路を no ip route で消す行は、設定の命令として扱う（読み取り専用の誤りになる）', () => {
    expect(isConfigLine('no ip route 10.0.9.0 255.255.255.0', exec, tr)).toBe(true);
  });

  it('木の設定の命令（writes）は、読み取り専用の判定でも設定の行になる', () => {
    expect(isConfigLine('hostname R1', exec, tr)).toBe(true);
    expect(isConfigLine('no hostname', exec, tr)).toBe(true);
  });

  it('確認の命令と、解釈の誤りになる行は、設定の命令として扱わない', () => {
    expect(isConfigLine('show ip route', exec, tr)).toBe(false);
    expect(isConfigLine('ip route abc', exec, tr)).toBe(false);
  });
});
