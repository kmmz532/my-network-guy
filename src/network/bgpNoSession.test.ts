import { ping } from './engine';
import { analyze } from './engine/analyze';
// BGP の失敗 bgp.no_session（N147）: 相手のアドレスか AS 番号が合わず、隣接しないときは経路を覚えない
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import type { Iface, NetLink, NetNode, Network } from './types';

const f = (port: number, ip: string): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24 });
const n = (uid: string, device: string, interfaces: Iface[], x: number, extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device, x, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports: [], ...extra }) as NetNode;
const l = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });

// PC A — R1（AS 65001）— R2（AS 65002）— PC B。R1 の neighbor の AS 番号（65009）が、R2 の AS（65002）と合わない
const net = (remoteAs: number): Network => ({
  nodes: [
    n('pa', 'pc_basic', [f(0, '10.0.1.10')], 0, { gateway: '10.0.1.1' }),
    n('r1', 'router_basic', [f(0, '10.0.1.1'), f(1, '10.0.12.1')], 1, { bgp: { asn: 65001, neighbors: [{ ip: '10.0.12.2', remoteAs }], networks: [{ dest: '10.0.1.0', prefix: 24 }] } }),
    n('r2', 'router_basic', [f(0, '10.0.12.2'), f(1, '10.0.2.1')], 2, { bgp: { asn: 65002, neighbors: [{ ip: '10.0.12.1', remoteAs: 65001 }], networks: [{ dest: '10.0.2.0', prefix: 24 }] } }),
    n('pb', 'pc_basic', [f(0, '10.0.2.10')], 3, { gateway: '10.0.2.1' }),
  ],
  links: [l('l0', 'pa', 0, 'r1', 0), l('l1', 'r1', 1, 'r2', 0), l('l2', 'r2', 1, 'pb', 0)],
  plans: {},
});

describe('bgp.no_session（N147）', () => {
  it('AS 番号が合わない隣接は、経路を覚えず bgp.no_session になる', () => {
    const r = ping(analyze(net(65009), gameEnv.engine), 'pa', 'pb');
    expect(r.ok).toBe(false);
    expect(r.failure?.reason).toBe('bgp.no_session');
  });
  it('AS 番号が合えば、届く', () => {
    expect(ping(analyze(net(65002), gameEnv.engine), 'pa', 'pb').ok).toBe(true);
  });
});
