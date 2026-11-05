import { describe, expect, it } from 'vitest';
import { DRAG_THRESHOLD_PX, isDragMove, portHoverAt, replugTargetAt, type PortBox } from './rearDrag';

// 横に 3 つ並んだポート（幅 20、高さ 30、間隔 4）
const boxes: PortBox[] = [0, 1, 2].map((port) => ({ port, left: port * 24, top: 0, right: port * 24 + 20, bottom: 30 }));
const usedOnly0 = (port: number) => port === 0;

describe('背面のドラッグの判定', () => {
  it('しきい値は 4 px', () => {
    expect(DRAG_THRESHOLD_PX).toBe(4);
  });

  it('4 px 未満の動きはドラッグにしない、4 px 以上はドラッグにする', () => {
    expect(isDragMove(100, 100, 103, 100)).toBe(false);
    expect(isDragMove(100, 100, 102, 102)).toBe(false); // 約 2.8 px
    expect(isDragMove(100, 100, 104, 100)).toBe(true);
    expect(isDragMove(100, 100, 100, 96)).toBe(true);
  });

  it('点が空きポートの上なら free、埋まっていれば used', () => {
    expect(portHoverAt(5, 5, boxes, usedOnly0)).toEqual({ port: 0, state: 'used' });
    expect(portHoverAt(29, 5, boxes, usedOnly0)).toEqual({ port: 1, state: 'free' });
  });

  it('どのポートの上でもなければ null（枠の右端・下端は含まない）', () => {
    expect(portHoverAt(22, 5, boxes, usedOnly0)).toBeNull();
    expect(portHoverAt(20, 5, boxes, usedOnly0)).toBeNull();
    expect(portHoverAt(5, 30, boxes, usedOnly0)).toBeNull();
    expect(portHoverAt(-1, 5, boxes, usedOnly0)).toBeNull();
  });

  it('空いているポートの上で離すと、そのポートが挿し替え先になる', () => {
    expect(replugTargetAt(29, 5, boxes, usedOnly0)).toBe(1);
    expect(replugTargetAt(53, 15, boxes, usedOnly0)).toBe(2);
  });

  it('埋まっているポートの上や枠の外で離すと、挿し替え先はない', () => {
    expect(replugTargetAt(5, 5, boxes, usedOnly0)).toBeNull();
    expect(replugTargetAt(200, 200, boxes, usedOnly0)).toBeNull();
  });
});
