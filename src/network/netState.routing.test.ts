import { ping } from './engine';
import { analyze } from './engine/analyze';
// 動的経路（RIP・OSPF の MVP）。段4の計算の結果が、転送（ping）に使われることを確かめる（N141b・N142）
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import type { Iface, Network, NetNode, NetLink, Route } from './types';

const iface = (port: number, ip: string, extra: Partial<Iface> = {}): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24, ...extra });
const node = (uid: string, device: string, interfaces: Iface[], gateway: string | null = null, routes: Route[] = [], x = 0): NetNode => ({
  uid,
  device,
  x,
  y: 0,
  locked: false,
  configLocked: false,
  interfaces,
  gateway,
  routes,
  services: [],
  ports: [],
});
const link = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({
  uid,
  cable: 'utp_cat5e',
  a: { node: a, port: pa },
  b: { node: b, port: pb },
  path: [[0, 0], [1, 0]],
  paid: 0,
});

// PC A(10.0.1.10) — R1 — R2 — PC B(10.0.2.10)。中継のサブネットは 10.0.12.0/24
const line = (joined: boolean, proto: 'rip' | 'ospf' = 'rip', extra: Route[] = []): Network => {
  const flag = () => (joined ? (proto === 'rip' ? { rip: true } : { ospf: { area: 0 } }) : {});
  return {
    nodes: [
      node('pa', 'pc_basic', [iface(0, '10.0.1.10')], '10.0.1.1', [], 0),
      node('r1', 'router_basic', [iface(0, '10.0.1.1', flag()), iface(1, '10.0.12.1', flag())], null, extra, 1),
      node('r2', 'router_basic', [iface(0, '10.0.12.2', flag()), iface(1, '10.0.2.1', flag())], null, [], 2),
      node('pb', 'pc_basic', [iface(0, '10.0.2.10')], '10.0.2.1', [], 3),
    ],
    links: [link('l0', 'pa', 0, 'r1', 0), link('l1', 'r1', 1, 'r2', 0), link('l2', 'r2', 1, 'pb', 0)],
    plans: {},
  };
};

describe('動的経路（RIP・OSPF）', () => {
  it('参加していなければ、離れたサブネットには届かない（今までどおり）', () => {
    expect(ping(analyze(line(false), gameEnv.engine), 'pa', 'pb').ok).toBe(false);
  });

  it('RIP に参加すると、両方向に届く', () => {
    expect(ping(analyze(line(true, 'rip'), gameEnv.engine), 'pa', 'pb').ok).toBe(true);
    expect(ping(analyze(line(true, 'rip'), gameEnv.engine), 'pb', 'pa').ok).toBe(true);
  });

  it('OSPF（エリア 0）に参加すると、届く', () => {
    expect(ping(analyze(line(true, 'ospf'), gameEnv.engine), 'pa', 'pb').ok).toBe(true);
  });

  it('OSPF は、エリアの違う口どうしは隣接せず、届かない（N142）', () => {
    const net = line(true, 'ospf');
    const other = { ...net, nodes: net.nodes.map((x) => (x.uid === 'r2' ? { ...x, interfaces: x.interfaces.map((i) => (i.port === 0 ? { ...i, ospf: { area: 1 } } : i)) } : x)) };
    expect(ping(analyze(other, gameEnv.engine), 'pa', 'pb').ok).toBe(false);
  });

  it('設定した経路（static）は、RIP の経路より優先される（管理距離）', () => {
    // R1 に、宛先 10.0.2.0/24 を直接 10.0.12.2 へ向ける static を置く。RIP の経路と同じ宛先で、AD が小さい static が選ばれる
    const net = line(true, 'rip', [{ dest: '10.0.2.0', prefix: 24, nextHop: '10.0.12.2' }]);
    expect(ping(analyze(net, gameEnv.engine), 'pa', 'pb').ok).toBe(true);
  });
});
