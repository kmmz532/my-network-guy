// BGP（eBGP・MVP）。隣接が合うと経路が届き、設定が合わないと届かない（N147）
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import { ping } from './netState';
import type { BgpConfig, Iface, NetNode, Network } from './types';

const iface = (port: number, ip: string): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24 });
const node = (uid: string, device: string, interfaces: Iface[], gateway: string | null, bgp?: BgpConfig, x = 0): NetNode => ({
  uid,
  device,
  x,
  y: 0,
  locked: false,
  configLocked: false,
  interfaces,
  gateway,
  routes: [],
  services: [],
  ports: [],
  ...(bgp ? { bgp } : {}),
});
const link = (uid: string, a: string, pa: number, b: string, pb: number) => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]] as [number, number][], paid: 0 });

// PC A(10.0.1.10) — R1(AS100) — R2(AS200) — PC B(10.0.2.10)。R1 と R2 は 10.0.12.0/24 で eBGP
const build = (r1: BgpConfig | undefined, r2: BgpConfig | undefined): Network => ({
  nodes: [
    node('pa', 'pc_basic', [iface(0, '10.0.1.10')], '10.0.1.1', undefined, 0),
    node('r1', 'router_basic', [iface(0, '10.0.1.1'), iface(1, '10.0.12.1')], null, r1, 1),
    node('r2', 'router_basic', [iface(0, '10.0.12.2'), iface(1, '10.0.2.1')], null, r2, 2),
    node('pb', 'pc_basic', [iface(0, '10.0.2.10')], '10.0.2.1', undefined, 3),
  ],
  links: [link('l0', 'pa', 0, 'r1', 0), link('l1', 'r1', 1, 'r2', 0), link('l2', 'r2', 1, 'pb', 0)],
  segments: {},
});

const r1Ok: BgpConfig = { asn: 100, neighbors: [{ ip: '10.0.12.2', remoteAs: 200 }], networks: [{ dest: '10.0.1.0', prefix: 24 }] };
const r2Ok: BgpConfig = { asn: 200, neighbors: [{ ip: '10.0.12.1', remoteAs: 100 }], networks: [{ dest: '10.0.2.0', prefix: 24 }] };

describe('BGP（eBGP・MVP）', () => {
  it('両方が相手の AS と隣接を設定すると、両方向に届く', () => {
    const net = build(r1Ok, r2Ok);
    expect(ping(net, gameEnv.engine, 'pa', 'pb').ok).toBe(true);
    expect(ping(net, gameEnv.engine, 'pb', 'pa').ok).toBe(true);
  });

  it('片方だけ隣接を設定すると、セッションが張れず届かない', () => {
    expect(ping(build(r1Ok, undefined), gameEnv.engine, 'pa', 'pb').ok).toBe(false);
  });

  it('相手の AS の番号が違うと、セッションが張れず届かない', () => {
    const wrong: BgpConfig = { ...r1Ok, neighbors: [{ ip: '10.0.12.2', remoteAs: 300 }] };
    expect(ping(build(wrong, r2Ok), gameEnv.engine, 'pa', 'pb').ok).toBe(false);
  });
});
