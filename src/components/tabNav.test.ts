import { describe, expect, it } from 'vitest';
import { nextTab } from './tabNav';

const TABS = ['device', 'furniture'] as const;
const THREE = ['rear', 'config', 'service'] as const;

describe('nextTab', () => {
  it('左右の矢印で隣のタブを選び、端では反対側へ回る', () => {
    expect(nextTab(TABS, 'device', 'ArrowRight')).toBe('furniture');
    expect(nextTab(TABS, 'furniture', 'ArrowRight')).toBe('device');
    expect(nextTab(TABS, 'device', 'ArrowLeft')).toBe('furniture');
    expect(nextTab(TABS, 'furniture', 'ArrowLeft')).toBe('device');
  });

  it('タブが3つでも、隣へ進み、端で回る', () => {
    expect(nextTab(THREE, 'rear', 'ArrowRight')).toBe('config');
    expect(nextTab(THREE, 'service', 'ArrowRight')).toBe('rear');
    expect(nextTab(THREE, 'rear', 'ArrowLeft')).toBe('service');
  });

  it('Home と End で先頭と末尾を選ぶ', () => {
    expect(nextTab(TABS, 'furniture', 'Home')).toBe('device');
    expect(nextTab(TABS, 'device', 'End')).toBe('furniture');
    expect(nextTab(THREE, 'config', 'End')).toBe('service');
  });

  it('対象外のキーでは何も選ばない', () => {
    expect(nextTab(TABS, 'device', 'ArrowUp')).toBeNull();
    expect(nextTab(TABS, 'device', 'Enter')).toBeNull();
  });

  it('タブがないときは何も選ばない', () => {
    expect(nextTab([] as readonly string[], 'device', 'ArrowRight')).toBeNull();
    expect(nextTab([] as readonly string[], 'device', 'Home')).toBeNull();
  });
});
