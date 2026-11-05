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
    const s = parseSettings(JSON.stringify({ uiScale: 1.25, guide: false, showIp: false, startSpeed: 4, pausedBuild: 'stay' }));
    expect(s).toEqual({ uiScale: 1.25, guide: false, showIp: false, startSpeed: 4, pausedBuild: 'stay' });
  });

  it('UIの大きさは 80・100・125・150% の4つだけ', () => {
    for (const v of [0.8, 1, 1.25, 1.5]) {
      expect(parseSettings(JSON.stringify({ uiScale: v })).uiScale).toBe(v);
    }
    expect(parseSettings(JSON.stringify({ uiScale: 1.1 })).uiScale).toBe(1);
  });
});

describe('一時停止中の施工の扱い', () => {
  it('既定は確認を出す', () => {
    expect(DEFAULT_SETTINGS.pausedBuild).toBe('ask');
    expect(parseSettings(JSON.stringify({ pausedBuild: 'play' })).pausedBuild).toBe('play');
  });
});
