import { describe, expect, it } from 'vitest';
import { nextShopSection, SHOP_SECTIONS } from './shopTabs';

describe('nextShopSection', () => {
  it('左右の矢印で隣のタブを選び、端では反対側へ回る', () => {
    expect(nextShopSection(SHOP_SECTIONS, 'device', 'ArrowRight')).toBe('furniture');
    expect(nextShopSection(SHOP_SECTIONS, 'furniture', 'ArrowRight')).toBe('device');
    expect(nextShopSection(SHOP_SECTIONS, 'device', 'ArrowLeft')).toBe('furniture');
    expect(nextShopSection(SHOP_SECTIONS, 'furniture', 'ArrowLeft')).toBe('device');
  });

  it('Home と End で先頭と末尾を選ぶ', () => {
    expect(nextShopSection(SHOP_SECTIONS, 'furniture', 'Home')).toBe('device');
    expect(nextShopSection(SHOP_SECTIONS, 'device', 'End')).toBe('furniture');
  });

  it('対象外のキーでは何も選ばない', () => {
    expect(nextShopSection(SHOP_SECTIONS, 'device', 'ArrowUp')).toBeNull();
    expect(nextShopSection(SHOP_SECTIONS, 'device', 'Enter')).toBeNull();
  });
});
