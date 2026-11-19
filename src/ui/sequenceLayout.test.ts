import { describe, expect, it } from 'vitest';
import type { ControlStep } from '../network/public';
import { sequenceLayout } from './sequenceLayout';

const step = (from: string, to: string, proto: ControlStep['proto'], reached: string[] = [to]): ControlStep => ({ from, to, reached, proto, label: 'seq.x', path: [from] });

describe('sequenceLayout', () => {
  it('線は出てくる順で、ブロードキャストは届いた機器ごとに矢印を持つ', () => {
    const { lanes, rows } = sequenceLayout([
      step('pc', '*', 'arp', ['r1', 'r2']),
      step('r1', 'pc', 'arp'),
      step('pc', 'r1', 'icmp'),
    ]);
    expect(lanes).toEqual(['pc', 'r1', 'r2']);
    expect(rows[0].targets).toEqual([1, 2]);
    expect(rows[1].targets).toEqual([0]);
    expect(rows.map((r) => r.dashed)).toEqual([true, true, false]);
  });
});
