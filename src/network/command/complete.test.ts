import { describe, expect, it } from 'vitest';
import { completeLine } from './complete';
import type { CommandContext } from './types';

const ctx = { session: { mode: 'exec', iface: null, process: null }, unlocked: () => true } as unknown as CommandContext;

describe('completeLine', () => {
  it('候補が1つなら、続きを書き足して空白を付ける', () => {
    expect(completeLine('trace', ctx)).toBe('traceroute ');
    expect(completeLine('show run', ctx)).toBe('show running-config ');
    expect(completeLine('ip add', ctx)).toBe('ip address ');
  });

  it('候補が複数なら、共通の続きまで書き足す', () => {
    expect(completeLine('show ip ro', ctx)).toBe('show ip route ');
    expect(completeLine('show ip r', ctx)).toBe('show ip r');
  });

  it('候補がなければ変えない', () => {
    expect(completeLine('xyz', ctx)).toBe('xyz');
    expect(completeLine('ping ', ctx)).toBe('ping ');
  });

  it('解放されていない論点の命令は補完しない', () => {
    const locked = { ...ctx, unlocked: () => false } as unknown as CommandContext;
    expect(completeLine('show ip ro', locked)).toBe('show ip ro');
  });
});
