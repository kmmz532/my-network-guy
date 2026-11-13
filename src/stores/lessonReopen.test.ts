// 教材を開き直しても、ケーブルのネットワークごとの色が同じに付く（初回と同じ）
import { beforeEach, describe, expect, it } from 'vitest';
import { colorOfLink } from '../network/netColor';
import { networkColors } from '../network/public';
import { analyze } from '../network/engine/analyze';
import { gameEnv } from '../sim/env';
import { useGameStore } from './useGameStore';

const st = () => useGameStore.getState();
const colorsOf = (): number[] => {
  const o = st().office;
  const net = analyze({ nodes: o.nodes, links: o.links, segments: o.segments }, gameEnv.engine).addressing.completed;
  const colors = networkColors(analyze(net, gameEnv.engine));
  return o.links.map((l) => colorOfLink(colors, l.uid));
};

describe('教材を開き直したときの色', () => {
  beforeEach(() => st().newSandbox());
  it('OSPF の教材を開き直しても、初回と同じ色になる', () => {
    st().openLesson('ospf_three_sites');
    const first = colorsOf();
    st().closeLesson();
    st().openLesson('ospf_three_sites');
    expect(colorsOf()).toEqual(first);
    st().openLesson('ospf_three_sites');
    expect(colorsOf()).toEqual(first);
    // 色が付いている（灰色 0x9a9a9a ではない）
    expect(first.every((c) => c !== 0x9a9a9a)).toBe(true);
  });
});
