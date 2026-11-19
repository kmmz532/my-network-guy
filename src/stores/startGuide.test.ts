// 始めの案内 start: 終えたら guidesDone と端末の記録に入り、2社目以降とサンドボックスでは出さない。新しく始めた直後は時間を止め、受注したら1倍で動かす
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSettings, saveSettings } from '../settings/settings';
import { START_GUIDE } from '../sim/guide';
import { startGuideHolds } from './gameHelpers';
import { useGameStore } from './useGameStore';

const st = () => useGameStore.getState();

describe('始めの案内', () => {
  beforeEach(() => {
    const mem = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('新しく始めた直後は出し、終えたら guidesDone と端末に入って、次の会社では出さない', () => {
    st().newGame('一社目');
    expect(startGuideHolds(st())).toBe(true);
    st().markGuideDone(START_GUIDE);
    expect(st().guidesDone).toContain(START_GUIDE);
    expect(loadSettings().startGuideDone).toBe(true);
    st().newGame('二社目');
    expect(st().guidesDone).toEqual([]);
    expect(startGuideHolds(st())).toBe(false);
  });

  it('サンドボックスでは出さない', () => {
    st().newSandbox();
    expect(startGuideHolds(st())).toBe(false);
  });

  it('案内の設定がオフなら出さない', () => {
    saveSettings({ guide: false });
    st().newGame('会社');
    expect(startGuideHolds(st())).toBe(false);
  });

  it('受注したら、止めていた時間を1倍で動かす', () => {
    saveSettings({ designPause: false });
    st().newGame('会社');
    st().setSpeed(0);
    const offer = st().offers[0];
    expect(offer.baseId).toBe('c001_direct_link');
    expect(st().accept(offer.id, st().staff.map((m) => m.uid).slice(0, 1))).toBeNull();
    expect(st().speed).toBe(1);
    expect(startGuideHolds(st())).toBe(false);
  });
});
