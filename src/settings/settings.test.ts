import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from './settings';

describe('parseSettings（端末の設定の読み込み）', () => {
  it('保存がなければ既定の値', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.uiScale).toBe(1);
  });

  it('壊れた文字列は既定の値（例外を出さない）', () => {
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('42')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('null')).toEqual(DEFAULT_SETTINGS);
  });

  it('範囲外・型の違う値は、その項目だけ既定の値に戻す', () => {
    const s = parseSettings(JSON.stringify({ uiScale: 2, guide: 'no', showIp: false, startSpeed: 3, pausedBuild: 'x' }));
    expect(s).toEqual({ ...DEFAULT_SETTINGS, showIp: false });
  });

  it('正しい値はそのまま読む', () => {
    const s = parseSettings(JSON.stringify({ uiScale: 1.25, guide: false, showIp: false, startSpeed: 4, pausedBuild: 'stay', autoSave: 'weekly', autoIp: false }));
    expect(s).toEqual({ uiScale: 1.25, guide: false, showIp: false, startSpeed: 4, pausedBuild: 'stay', autoSave: 'weekly', autoIp: false, designPause: true });
  });

  it('UIの大きさは 80・100・125・150% の4つだけ', () => {
    for (const v of [0.8, 1, 1.25, 1.5]) {
      expect(parseSettings(JSON.stringify({ uiScale: v })).uiScale).toBe(v);
    }
    expect(parseSettings(JSON.stringify({ uiScale: 1.1 })).uiScale).toBe(1);
  });
});

describe('自動保存の間隔', () => {
  it('既定は毎日', () => {
    expect(DEFAULT_SETTINGS.autoSave).toBe('daily');
  });

  it('キーがない古い設定は既定の毎日になる（他の項目はそのまま読む）', () => {
    const s = parseSettings(JSON.stringify({ uiScale: 1.25, showIp: false }));
    expect(s.autoSave).toBe('daily');
    expect(s.uiScale).toBe(1.25);
    expect(s.showIp).toBe(false);
  });

  it('しない・毎日・毎週の3つを読み、それ以外は既定に戻す', () => {
    for (const v of ['off', 'daily', 'weekly']) {
      expect(parseSettings(JSON.stringify({ autoSave: v })).autoSave).toBe(v);
    }
    for (const v of ['hourly', true, 1, null]) {
      expect(parseSettings(JSON.stringify({ autoSave: v })).autoSave).toBe('daily');
    }
  });
});

describe('一時停止中の施工の扱い', () => {
  it('既定は確認を出す', () => {
    expect(DEFAULT_SETTINGS.pausedBuild).toBe('ask');
    expect(parseSettings(JSON.stringify({ pausedBuild: 'play' })).pausedBuild).toBe('play');
  });
});

describe('IPアドレスの自動割り当て', () => {
  it('既定はオン。キーがない古い設定も既定のオンになる（他の項目はそのまま読む）', () => {
    expect(DEFAULT_SETTINGS.autoIp).toBe(true);
    const s = parseSettings(JSON.stringify({ uiScale: 1.25, autoSave: 'weekly' }));
    expect(s.autoIp).toBe(true);
    expect(s.uiScale).toBe(1.25);
    expect(s.autoSave).toBe('weekly');
  });

  it('true と false はそのまま読み、それ以外の値は既定のオンに戻す', () => {
    expect(parseSettings(JSON.stringify({ autoIp: false })).autoIp).toBe(false);
    expect(parseSettings(JSON.stringify({ autoIp: true })).autoIp).toBe(true);
    for (const v of ['off', 0, null, 'false']) {
      expect(parseSettings(JSON.stringify({ autoIp: v })).autoIp).toBe(true);
    }
  });
});

describe('設計に入ったら時間を止める', () => {
  it('既定はオン。キーがない古い設定もオンになる', () => {
    expect(DEFAULT_SETTINGS.designPause).toBe(true);
    expect(parseSettings(JSON.stringify({ uiScale: 1.25 })).designPause).toBe(true);
  });

  it('true と false はそのまま読み、それ以外の値は既定のオンに戻す', () => {
    expect(parseSettings(JSON.stringify({ designPause: false })).designPause).toBe(false);
    expect(parseSettings(JSON.stringify({ designPause: true })).designPause).toBe(true);
    for (const v of ['off', 0, null]) {
      expect(parseSettings(JSON.stringify({ designPause: v })).designPause).toBe(true);
    }
  });
});
