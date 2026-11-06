// ホスト名の規則と自動の付け方（N68）
import { describe, expect, it } from 'vitest';
import { hostLabelOf, isValidHostname, nextHostname } from './hostname';
import type { NetNode } from './types';

const node = (hostname?: string): NetNode => ({
  uid: Math.random().toString(36).slice(2),
  device: 'pc_basic',
  hostname,
  x: 0,
  y: 0,
  locked: false,
  configLocked: false,
  interfaces: [],
  gateway: null,
  routes: [],
  services: [],
});

describe('ホスト名の形', () => {
  it('英字で始まり、英数字とハイフンだけを使う（63文字まで）', () => {
    expect(isValidHostname('R-1')).toBe(true);
    expect(isValidHostname('fileserver')).toBe(true);
    expect(isValidHostname('a'.repeat(63))).toBe(true);
    expect(isValidHostname('a'.repeat(64))).toBe(false);
  });

  it('先頭が数字・ハイフン、末尾がハイフン、記号や空白は不可', () => {
    expect(isValidHostname('1pc')).toBe(false);
    expect(isValidHostname('-pc')).toBe(false);
    expect(isValidHostname('pc-')).toBe(false);
    expect(isValidHostname('pc_1')).toBe(false);
    expect(isValidHostname('pc 1')).toBe(false);
    expect(isValidHostname('')).toBe(false);
  });
});

describe('ホスト名の自動の付け方', () => {
  it('種類の略号と番号（R-1・SW-1・PC-3）', () => {
    expect(hostLabelOf('router')).toBe('R');
    expect(nextHostname([], 'router')).toBe('R-1');
    expect(nextHostname([node('PC-1'), node('PC-2')], 'pc')).toBe('PC-3');
  });

  it('番号は、同じ略号の最大に1を足す（削除で空いた番号は使わず、重ならない）', () => {
    expect(nextHostname([node('PC-1'), node('PC-3')], 'pc')).toBe('PC-4');
    expect(nextHostname([node('SW-1'), node('PC-9')], 'l2_switch')).toBe('SW-2');
  });

  it('ホスト名のない機器は数えない', () => {
    expect(nextHostname([node(undefined)], 'server')).toBe('SRV-1');
  });
});
