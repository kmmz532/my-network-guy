// 吹き出しの用語: 初めてだけ出して記録し、2回目は出さない
import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from './useGameStore';

const st = () => useGameStore.getState();

describe('吹き出しの用語', () => {
  beforeEach(() => {
    st().newSandbox();
    st().closeTermNotice();
  });

  it('初めての用語は出して記録し、閉じた後の2回目は出さない', () => {
    st().introduceTerm('vrrp');
    expect(st().termNotice).toBe('vrrp');
    expect(st().termsShown).toContain('vrrp');
    st().closeTermNotice();
    st().introduceTerm('vrrp');
    expect(st().termNotice).toBeNull();
    expect(st().termsShown.filter((t) => t === 'vrrp')).toHaveLength(1);
  });

  it('案件の欄で記録した用語は、吹き出しでは出さない', () => {
    st().markTermShown('napt');
    st().introduceTerm('napt');
    expect(st().termNotice).toBeNull();
  });
});
