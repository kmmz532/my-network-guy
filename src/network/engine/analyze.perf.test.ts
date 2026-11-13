import { describe, expect, it } from 'vitest';
import { analyze } from './analyze';
import { ping } from '../engine';
import type { EngineData, NetLink, NetNode, Network } from '../types';

const data: EngineData = { wallAt: () => false };

const pc = (uid: string, ip: string): NetNode => ({
  ports: [],
  uid,
  device: 'pc_basic',
  x: 0,
  y: 0,
  locked: false,
  configLocked: false,
  interfaces: [{ id: 'g0/0', kind: 'port', port: 0, ip, prefix: 24 }],
  gateway: null,
  routes: [],
  services: [],
});

const link = (i: number): NetLink => ({
  uid: `l${i}`,
  cable: 'utp_cat5e',
  a: { node: `p${i}`, port: 0 },
  b: { node: 's', port: i },
  paid: 0,
  path: [
    [0, 0],
    [1, 0],
  ],
});

describe('機器の多い構成の計算量', () => {
  it('PC 300台を1台のスイッチにつないだ構成で、analyze と ping が短い時間で終わる', () => {
    const pcs = Array.from({ length: 300 }, (_, i) => pc(`p${i}`, `192.168.${Math.floor(i / 254)}.${(i % 254) + 1}`));
    const sw: NetNode = { ...pc('s', ''), device: 'l2_switch_8p', interfaces: [] };
    const net: Network = { nodes: [...pcs, sw], links: pcs.map((_, i) => link(i)), plans: { 'p0:0': { network: '192.168.0.0', prefix: 23 } } };
    const start = performance.now();
    const state = analyze(net, data);
    const result = ping(state, 'p0', 'p299');
    expect(result.ok).toBe(true);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});
