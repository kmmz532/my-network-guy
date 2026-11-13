import { ping } from './engine';
import { analyze } from './engine/analyze';
// ospf.area_detached（NET.md §6）: エリア 0 に接していないエリアだけに参加している機器は、経路が届かない
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import type { Iface, NetLink, NetNode, Network } from './types';

const f = (port: number, ip: string, area?: number): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24, ...(area === undefined ? {} : { ospf: { area } }) });
const n = (uid: string, interfaces: Iface[], x: number): NetNode =>
  ({ uid, device: uid.startsWith('p') ? 'pc_basic' : 'router_basic', x, y: 0, locked: false, configLocked: false, interfaces, gateway: uid.startsWith('p') ? interfaces[0].ip.replace(/\.\d+$/, '.1') : null, routes: [], services: [], ports: [] }) as NetNode;
const l = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });

// PC A — R1（OSPF に参加しない）— R2（エリア 1 だけに参加）— PC B。R2 はエリア 0 に接しておらず、隣接もないため、A へ経路を得られない
const net = (): Network => ({
  nodes: [
    n('pa', [f(0, '10.0.1.10')], 0),
    n('r1', [f(0, '10.0.1.1'), f(1, '10.0.12.1')], 1),
    n('r2', [f(0, '10.0.12.2', 1), f(1, '10.0.2.1', 1)], 2),
    n('pb', [f(0, '10.0.2.10')], 3),
  ],
  links: [l('l0', 'pa', 0, 'r1', 0), l('l1', 'r1', 1, 'r2', 0), l('l2', 'r2', 1, 'pb', 0)],
  plans: {},
});

describe('ospf.area_detached（NET.md §6）', () => {
  it('エリア 0 に接していないエリアだけの機器は、経路がエリア 0 へ届かない', () => {
    const r = ping(analyze(net(), gameEnv.engine), 'pb', 'pa');
    expect(r.ok).toBe(false);
    expect(r.failure?.reason).toBe('ospf.area_detached');
  });
});
