import { describe, expect, it } from 'vitest';
import { nearBoxes, portPickAt, portToPlug, type PickBox } from './portPick';

// 縦に並んだ一覧: おまかせ（0〜20）、口 0（20〜40）、口 1（40〜60。差せない）、口 2（60〜80）
const boxes: PickBox[] = [
  { port: 'auto', left: 100, top: 0, right: 200, bottom: 20, blocked: false },
  { port: 0, left: 100, top: 20, right: 200, bottom: 40, blocked: false },
  { port: 1, left: 100, top: 40, right: 200, bottom: 60, blocked: true },
  { port: 2, left: 100, top: 60, right: 200, bottom: 80, blocked: false },
];
const plug = (x: number, y: number) => portToPlug(portPickAt(x, y, boxes));

describe('持ったケーブルを離した位置から差す口を決める', () => {
  it('口の上で離すとその口に差す', () => {
    expect(plug(150, 30)).toBe(0);
    expect(plug(150, 70)).toBe(2);
  });

  it('一覧の外（機器の上）で離すと自動で差す', () => {
    expect(plug(50, 30)).toBeNull();
    expect(plug(150, 200)).toBeNull();
  });

  it('おまかせの上で離すと自動で差す', () => {
    expect(plug(150, 10)).toBeNull();
  });

  it('差せない口の上で離しても、その口は選ばれない（何もしない）', () => {
    expect(plug(150, 50)).toBeUndefined();
  });

  it('行の境は、下の行に属する（上の端は含み、下の端は含まない）', () => {
    expect(plug(150, 20)).toBe(0);
    expect(plug(150, 40)).toBeUndefined();
  });

  it('一覧の枠の近く（隙間）は、一覧の外でも近いと判定する', () => {
    expect(nearBoxes(90, 40, boxes, 24)).toBe(true);
    expect(nearBoxes(50, 40, boxes, 24)).toBe(false);
    expect(nearBoxes(150, 40, [], 24)).toBe(false);
  });
});
