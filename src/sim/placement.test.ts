// 机の上の判定（restsOnDesk）の試験
import { describe, expect, it } from 'vitest';
import type { NetNode } from '../network/types';
import { restsOnDesk } from './placement';

const deskAt = (x: number, y: number): boolean => x === 1 && y === 1;
const nodeAt = (x: number, y: number, device: string): NetNode => ({ uid: 'u1', device, x, y, ports: [] } as unknown as NetNode);

describe('机の上の判定', () => {
  it('机のマスにある PC は机の上にある', () => {
    expect(restsOnDesk(nodeAt(1, 1, 'pc'), deskAt)).toBe(true);
  });

  it('床の PC は机の上にない', () => {
    expect(restsOnDesk(nodeAt(2, 2, 'pc'), deskAt)).toBe(false);
  });

  it('机のマスでない機器は机の上にない', () => {
    expect(restsOnDesk(nodeAt(2, 2, 'router'), deskAt)).toBe(false);
  });
});
