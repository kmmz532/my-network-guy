import { describe, expect, it } from 'vitest';
import { isLegacyConfig } from './run';
import type { TerminalSession } from './types';

const exec: TerminalSession = { mode: 'exec', iface: null, process: null };
const tr = (key: string) => key;

describe('読み取り専用の機器が先に拒否する行', () => {
  it('存在しない経路を no ip route で消す行は、設定の命令として扱う（読み取り専用の誤りになる）', () => {
    expect(isLegacyConfig('no ip route 10.0.9.0 255.255.255.0', exec, tr)).toBe(true);
  });

  it('確認の命令と、解釈の誤りになる行は、設定の命令として扱わない', () => {
    expect(isLegacyConfig('show ip route', exec, tr)).toBe(false);
    expect(isLegacyConfig('ip route abc', exec, tr)).toBe(false);
  });
});
