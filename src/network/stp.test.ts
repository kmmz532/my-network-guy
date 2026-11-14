import { ping } from './engine';
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import { analyze } from './engine/analyze';
import { stpOf } from './query/stp';
import type { EngineData, Iface, NetLink, NetNode, Network } from './types';
import type { NetworkState } from './engine/state';

const data = gameEnv.engine;
const f = (ip: string): Iface => ({ id: 'eth0', kind: 'port', port: 0, ip, prefix: 24 });
const node = (uid: string, device: string, serial: number, extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device, macSerial: serial, x: 0, y: 0, locked: false, configLocked: false, interfaces: [], gateway: null, routes: [], services: [], ports: [], ...extra }) as NetNode;
const link = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });

// SW1・SW2・SW3 の三角形。PC1 は SW1、PC2 は SW3
const triangle = (priority3?: number): Network => ({
  nodes: [
    node('sw1', 'l2_switch_8p', 1),
    node('sw2', 'l2_switch_8p', 2),
    node('sw3', 'l2_switch_8p', 3, priority3 === undefined ? {} : { stpPriority: priority3 }),
    node('p1', 'pc_basic', 10, { interfaces: [f('192.168.1.11')] }),
    node('p2', 'pc_basic', 11, { interfaces: [f('192.168.1.12')] }),
  ],
  links: [link('a', 'sw1', 0, 'sw2', 0), link('b', 'sw1', 1, 'sw3', 0), link('c', 'sw2', 1, 'sw3', 1), link('d', 'p1', 0, 'sw1', 2), link('e', 'p2', 0, 'sw3', 2)],
  plans: {},
});

describe('スパニングツリー', () => {
  it('連番が最小のスイッチがルートになり、輪の1か所の口を止める', () => {
    const r = stpOf(analyze(triangle(), data));
    expect(r.root).toBe('sw1');
    expect(r.roles.get('sw3:1')).toBe('blocking');
    expect(r.roles.get('sw2:1')).toBe('designated');
    expect(r.roles.get('sw2:0')).toBe('root');
    expect([...r.roles.values()].filter((x) => x === 'blocking')).toHaveLength(1);
  });
  it('優先度を小さくしたスイッチがルートになり、止まる口が変わる', () => {
    const r = stpOf(analyze(triangle(4096), data));
    expect(r.root).toBe('sw3');
    expect(r.roles.get('sw3:1')).toBe('designated');
    expect(r.roles.get('sw2:0')).toBe('blocking');
  });
  it('輪があっても、スパニングツリーが断つので通信できる（link.loop にならない）', () => {
    expect(ping(analyze(triangle(), data), 'p1', 'p2').ok).toBe(true);
  });
  it('止めた口を使うリンクが切れても、残りの口で通信できる（冗長）', () => {
    const net = triangle();
    const cut: Network = { ...net, links: net.links.filter((l) => l.uid !== 'b') };
    expect(ping(analyze(cut, data), 'p1', 'p2').ok).toBe(true);
  });
});

describe('スパニングツリーのターミナル', () => {
  it('spanning-tree の priority・cost を読み、show spanning-tree はルートと口の役割を出す', async () => {
    const { commandContextOf, runLine } = await import('./command/run');
    const runShow = (line: string, c: Parameters<typeof commandContextOf>[0], tr: Parameters<typeof runLine>[2]) => runLine(line, commandContextOf(c, false), tr).lines;
    const tr = (k: string, p?: Record<string, unknown>) => (p ? `${k} ${JSON.stringify(p)}` : k);
    const tctx = commandContextOf({ node: {} as NetNode, nodes: [], links: [], data: {} as EngineData, state: {} as NetworkState }, false);
    const viaTree = (line: string) => {
      const r = runLine(line, tctx, tr);
      return r.change !== null ? { kind: 'action', action: r.change } : { kind: 'error', text: r.lines[0].text };
    };
    expect(viaTree('spanning-tree priority 4096')).toEqual({ kind: 'action', action: { kind: 'stp', change: { op: 'priority', value: 4096 } } });
    expect(viaTree('spanning-tree priority 100')).toEqual({ kind: 'error', text: 'ui.terminal.errStpPriority' });
    expect(viaTree('spanning-tree cost 1 19')).toEqual({ kind: 'action', action: { kind: 'stp', change: { op: 'cost', port: 1, value: 19 } } });
    const net = triangle();
    const lines = runShow('show spanning-tree', { node: net.nodes[2], nodes: net.nodes, links: net.links, data, state: analyze({ nodes: net.nodes, links: net.links }, data) }, tr);
    expect(lines[0].text).toContain('ui.terminal.stpRoot');
    expect(lines.some((l) => l.text.startsWith('ui.terminal.stpPort.blocking'))).toBe(true);
  });
});
