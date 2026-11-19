import { describe, expect, it } from 'vitest';
import { pickTab } from './DevicePanel';

describe('pickTab', () => {
  it('設定の欄のない機器で設定の欄を求めたら、最初の欄（背面）にする', () => {
    expect(pickTab('config', ['rear', 'terminal'])).toBe('rear');
  });
  it('持っている欄を求めたら、その欄にする', () => {
    expect(pickTab('terminal', ['rear', 'config', 'terminal'])).toBe('terminal');
  });
  it('求めがなければ最初の欄にする', () => {
    expect(pickTab(undefined, ['rear', 'config', 'terminal'])).toBe('rear');
  });
});
