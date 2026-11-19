import { describe, expect, it } from 'vitest';
import { lessons } from 'virtual:game-data';
import { solutions } from '../../__golden__/solutions';
import { lessonLinks, lessonNodes } from '../../sim/lesson';
import { analyze } from '../engine/analyze';
import type { EngineData, NetNode } from '../types';
import { routeCodeOf, routeTableOf } from './routeTable';

const engine: EngineData = { wallAt: () => false, interferers: [] };

// OSPF の3拠点の正解の構成（R1 は直結 3 本と、OSPF で覚えた他拠点の経路）に、静的経路を1本足す
const solved = () => {
  const l = lessons.find((x) => x.id === 'ospf_three_sites');
  if (!l) throw new Error('教材がない');
  const nodes = solutions[l.id](lessonNodes(l));
  const links = lessonLinks(l);
  return { nodes, links, state: analyze({ nodes, links, plans: {} }, engine) };
};

describe('機器の経路表（欄と show ip route が使う行）', () => {
  it('直結・OSPF の行に印を付け、直結と動的の行は消せない（routeIndex が null）', () => {
    const { nodes, state } = solved();
    const r1 = nodes.find((n) => n.uid === 'R1') as NetNode;
    const rows = routeTableOf(state, r1);
    expect(rows.filter((r) => r.source === 'connected')).toHaveLength(3);
    expect(rows.filter((r) => r.source === 'connected').every((r) => routeCodeOf(r) === 'C')).toBe(true);
    const ospf = rows.filter((r) => r.source === 'ospf');
    expect(ospf.length).toBeGreaterThan(0);
    expect(ospf.every((r) => routeCodeOf(r) === 'O' && r.source !== 'connected' && r.routeIndex === null)).toBe(true);
  });

  it('静的経路の行は、node.routes の添字を持ち、消せる行になる。既定のゲートウェイの行は消せない', () => {
    const { nodes, state } = solved();
    const r1 = nodes.find((n) => n.uid === 'R1') as NetNode;
    const withStatic: NetNode = { ...r1, routes: [{ dest: '10.9.0.0', prefix: 16, nextHop: '10.0.12.2' }], gateway: null };
    const rows = routeTableOf(state, withStatic);
    const statics = rows.filter((r) => r.source === 'static');
    expect(statics).toEqual([expect.objectContaining({ dest: '10.9.0.0', prefix: 16, routeIndex: 0 })]);
    expect(routeCodeOf(statics[0])).toBe('S');
    const withGateway: NetNode = { ...r1, routes: [], gateway: '10.0.1.2' };
    const gw = routeTableOf(state, withGateway).find((r) => r.source === 'static');
    expect(gw).toEqual(expect.objectContaining({ dest: '0.0.0.0', prefix: 0, routeIndex: null }));
    expect(routeCodeOf(gw as (typeof rows)[number])).toBe('S*');
  });
});
