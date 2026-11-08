// 段に分けた計算（netState）が、基準（__oracle__/engineLegacy）と同じ結果を返すことを、ランダムなネットワークで確かめる（N136）
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { gameEnv } from '../sim/env';
import * as legacy from './__oracle__/engineLegacy';
import * as staged from './netState';
import type { Network, NetNode, NetLink } from './types';

// l3_switch は基準と比べない。IP のない L3 の口は、N138 で既定の access（VLAN 1）に変えたため、基準（N136 の時点）と結果が違う。L3 の挙動は svi.test.ts で確かめる
const DEVICES = ['pc_basic', 'router_basic', 'l2_switch_8p', 'server_basic'] as const;
const IPS = ['10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.1.1', '10.0.1.2'];

const networkArb: fc.Arbitrary<Network> = fc
  .record({
    devices: fc.array(fc.constantFrom(...DEVICES), { minLength: 2, maxLength: 5 }),
    ifaces: fc.array(fc.record({ n: fc.nat(4), port: fc.nat(3), ip: fc.constantFrom(...IPS), prefix: fc.constantFrom(16, 24) }), { maxLength: 6 }),
    links: fc.array(fc.record({ a: fc.nat(4), pa: fc.nat(3), b: fc.nat(4), pb: fc.nat(3) }), { maxLength: 6 }),
    gateways: fc.array(fc.option(fc.constantFrom(...IPS), { nil: null }), { minLength: 5, maxLength: 5 }),
    routes: fc.array(fc.record({ dest: fc.constantFrom('10.0.0.0', '10.0.1.0'), prefix: fc.constantFrom(16, 24), next: fc.constantFrom(...IPS) }), { maxLength: 2 }),
  })
  .map(({ devices, ifaces, links, gateways, routes }) => {
    const nodes: NetNode[] = devices.map((device, i) => ({
      uid: `n${i}`,
      device: device as string,
      x: i * 2,
      y: 0,
      locked: false,
      configLocked: false,
      interfaces: [],
      gateway: gateways[i] ?? null,
      routes: i === 1 ? routes.map((r) => ({ dest: r.dest, prefix: r.prefix, nextHop: r.next })) : [],
      services: device === 'server_basic' ? [{ protocol: 'http', port: 80 }] : [],
      ports: [],
    }));
    for (const f of ifaces) {
      const node = nodes[f.n % nodes.length];
      if (node.interfaces.some((x) => x.port === f.port)) continue;
      node.interfaces.push({ id: `g0/${f.port}`, kind: 'port', port: f.port, ip: f.ip, prefix: f.prefix });
    }
    const seen = new Set<string>();
    const net: NetLink[] = [];
    for (const l of links) {
      const a = { node: `n${l.a % nodes.length}`, port: l.pa };
      const b = { node: `n${l.b % nodes.length}`, port: l.pb };
      const ka = `${a.node}:${a.port}`;
      const kb = `${b.node}:${b.port}`;
      if (ka === kb || seen.has(ka) || seen.has(kb)) continue;
      seen.add(ka);
      seen.add(kb);
      net.push({ uid: `l${net.length}`, cable: 'utp_cat5e', a, b, path: [[0, 0], [1, 0]], paid: 0 });
    }
    return { nodes, links: net, segments: {} };
  });

describe('段に分けた計算は、基準と同じ結果（N136）', () => {
  it('ping・http・ループの判定が、ランダムなネットワークで一致する', () => {
    fc.assert(
      fc.property(networkArb, (net) => {
        for (const src of net.nodes) {
          for (const dst of net.nodes) {
            if (src.uid === dst.uid) continue;
            expect(staged.ping(net, gameEnv.engine, src.uid, dst.uid)).toEqual(legacy.ping(net, gameEnv.engine, src.uid, dst.uid));
            expect(staged.http(net, gameEnv.engine, src.uid, dst.uid, 80)).toEqual(legacy.http(net, gameEnv.engine, src.uid, dst.uid, 80));
          }
        }
        expect(staged.loopNodeOf(net, gameEnv.engine)).toEqual(legacy.loopNodeOf(net, gameEnv.engine));
      }),
      { numRuns: 300, seed: 136 },
    );
  });
});
