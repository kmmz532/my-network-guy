import { describe, expect, it } from 'vitest';
import { colorsFromConfig, compile } from './compile';
import { ping } from './engine';
import type { EngineData, NetLink, NetNode } from './types';

const data: EngineData = {
  categoryOf: (device) => ({ pc: 'pc', l2: 'l2_switch', router: 'router' })[device] ?? 'unknown',
  maxLengthOf: () => 100,
};

const node = (uid: string, device: string, colors: Record<number, number> = {}): NetNode => ({
  uid,
  device,
  x: 0,
  y: 0,
  locked: false,
  configLocked: false,
  interfaces: [],
  gateway: null,
  routes: [],
  services: [],
  colors,
});

const fixedPc = (uid: string, ip: string, gateway: string): NetNode => ({
  ...node(uid, 'pc'),
  configLocked: true,
  interfaces: [{ port: 0, ip, prefix: 24 }],
  gateway,
});

let seq = 0;
const link = (a: string, ap: number, b: string, bp: number): NetLink => ({
  uid: `l${seq++}`,
  cable: 'utp',
  a: { node: a, port: ap },
  b: { node: b, port: bp },
  path: [
    [0, 0],
    [1, 0],
  ],
});

describe('compile', () => {
  it('同じ色のPCをスイッチでつなぐと疎通する', () => {
    const net = {
      nodes: [node('a', 'pc', { 0: 1 }), node('b', 'pc', { 0: 1 }), node('s', 'l2')],
      links: [link('a', 0, 's', 0), link('b', 0, 's', 1)],
    };
    const { net: out, issues } = compile(net, data);
    expect(issues).toEqual({});
    expect(ping(out, data, 'a', 'b').ok).toBe(true);
  });

  it('色を塗っていないPCは unset になる', () => {
    const net = { nodes: [node('a', 'pc', { 0: 1 }), node('b', 'pc')], links: [link('a', 0, 'b', 0)] };
    expect(compile(net, data).issues).toEqual({ b: 'unset' });
  });

  it('同じドメインに2色あると mixed になる', () => {
    const net = {
      nodes: [node('a', 'pc', { 0: 1 }), node('b', 'pc', { 0: 2 }), node('s', 'l2')],
      links: [link('a', 0, 's', 0), link('b', 0, 's', 1)],
    };
    const { issues } = compile(net, data);
    expect(issues.a).toBe('mixed');
    expect(issues.b).toBe('mixed');
  });

  it('固定設定のPCに合わせてルーターを塗ると部署間で疎通する', () => {
    const nodes = colorsFromConfig([
      fixedPc('sa', '192.168.1.11', '192.168.1.1'),
      fixedPc('da', '192.168.2.11', '192.168.2.1'),
      node('r', 'router'),
    ]);
    nodes[2].colors = { 0: nodes[0].colors![0], 1: nodes[1].colors![0] };
    const net = { nodes, links: [link('sa', 0, 'r', 0), link('da', 0, 'r', 1)] };
    const { net: out, issues } = compile(net, data);
    expect(issues).toEqual({});
    expect(out.nodes[2].interfaces.map((i) => i.ip)).toEqual(['192.168.1.1', '192.168.2.1']);
    expect(ping(out, data, 'sa', 'da').ok).toBe(true);
  });

  it('ルーターがない別の色のPCは no_gateway になる', () => {
    const net = {
      nodes: [node('a', 'pc', { 0: 1 }), node('b', 'pc', { 0: 2 })],
      links: [],
    };
    expect(compile(net, data).issues).toEqual({ a: 'no_gateway', b: 'no_gateway' });
  });

  it('2拠点のルーター間にルートを自動で設定する', () => {
    const net = {
      nodes: [
        node('h', 'pc', { 0: 1 }),
        node('r1', 'router', { 0: 1, 1: 3 }),
        node('r2', 'router', { 0: 2, 1: 3 }),
        node('b', 'pc', { 0: 2 }),
      ],
      links: [link('h', 0, 'r1', 0), link('r1', 1, 'r2', 1), link('r2', 0, 'b', 0)],
    };
    const { net: out, issues } = compile(net, data);
    expect(issues).toEqual({});
    expect(out.nodes[1].routes).toHaveLength(1);
    expect(ping(out, data, 'h', 'b').ok).toBe(true);
  });
});
