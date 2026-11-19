import { describe, expect, it } from 'vitest';
import { nightSpeedStep } from './nightSpeed';

const base = { working: false, building: true, always: false, speed: 1, saved: null, fastest: 4 };

describe('勤務時間外の自動の早送り', () => {
  it('勤務時間外に施工中なら、最速にして元の速さを覚える', () => {
    expect(nightSpeedStep(base)).toEqual({ speed: 4, saved: 1 });
  });

  it('勤務時間内は変えない', () => {
    expect(nightSpeedStep({ ...base, working: true })).toEqual({ speed: 1, saved: null });
  });

  it('施工中でなければ変えない', () => {
    expect(nightSpeedStep({ ...base, building: false })).toEqual({ speed: 1, saved: null });
  });

  it('停止中は自動で動かさない', () => {
    expect(nightSpeedStep({ ...base, speed: 0 })).toEqual({ speed: 0, saved: null });
  });

  it('すでに最速なら覚えない', () => {
    expect(nightSpeedStep({ ...base, speed: 4 })).toEqual({ speed: 4, saved: null });
  });

  it('自動で変えたあと、勤務時間になると元の速さへ戻す', () => {
    expect(nightSpeedStep({ ...base, working: true, speed: 4, saved: 2 })).toEqual({ speed: 2, saved: null });
  });

  it('自動で変えたあと、施工が終わったら戻す', () => {
    expect(nightSpeedStep({ ...base, building: false, speed: 4, saved: 1 })).toEqual({ speed: 1, saved: null });
  });

  it('夜の間は、覚えた速さを上書きしない', () => {
    expect(nightSpeedStep({ ...base, speed: 4, saved: 1 })).toEqual({ speed: 4, saved: 1 });
  });

  it('設定で常にするなら、施工がなくても勤務時間外は最速になる', () => {
    expect(nightSpeedStep({ ...base, building: false, always: true })).toEqual({ speed: 4, saved: 1 });
  });

  it('施工がなくても夜は最速のままで、昼に戻ると元の速さになる', () => {
    const night = nightSpeedStep({ ...base, building: false, always: true });
    expect(nightSpeedStep({ ...base, building: false, always: true, speed: night.speed, saved: night.saved })).toEqual({ speed: 4, saved: 1 });
    expect(nightSpeedStep({ ...base, working: true, building: false, always: true, speed: night.speed, saved: night.saved })).toEqual({ speed: 1, saved: null });
  });

  it('設定で常にするときも、止めている間は動かさない', () => {
    expect(nightSpeedStep({ ...base, building: false, always: true, speed: 0 })).toEqual({ speed: 0, saved: null });
  });

  it('設定を切ると、施工中だけ最速にする', () => {
    expect(nightSpeedStep({ ...base, building: false, always: false })).toEqual({ speed: 1, saved: null });
    expect(nightSpeedStep({ ...base, building: true, always: false })).toEqual({ speed: 4, saved: 1 });
  });
});
