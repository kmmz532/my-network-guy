import { describe, expect, it } from 'vitest';
import { http, linkLength, loopNodeOf, ping } from './engine';
import type { EngineData, NetLink, NetNode, Network } from './types';

const data: EngineData = { wallAt: () => false };

const pc = (uid: string, ip: string | null, gateway: string | null = null): NetNode => ({ ports: [],
  uid,
  device: 'pc_basic',
  x: 0,
  y: 0,
  locked: false,
  configLocked: false,
  interfaces: ip ? [{ id: "g0/0", kind: "port", port: 0, ip, prefix: 24 }] : [],
  gateway,
  routes: [],
  services: [],
});

const server = (uid: string, ip: string, services: NetNode['services']): NetNode => ({
  ...pc(uid, ip),
  device: 'server_basic',
  services,
});

const sw = (uid: string): NetNode => ({ ports: [],
  uid,
  device: 'l2_switch_4p',
  x: 0,
  y: 0,
  locked: false,
  configLocked: false,
  interfaces: [],
  gateway: null,
  routes: [],
  services: [],
});

const router = (uid: string, interfaces: NetNode['interfaces'], routes: NetNode['routes'] = []): NetNode => ({ ports: [],
  uid,
  device: 'router_basic',
  x: 0,
  y: 0,
  locked: false,
  configLocked: false,
  interfaces,
  gateway: null,
  routes,
  services: [],
});

// 長さ length タイルの直線の配線
const link = (uid: string, a: string, aPort: number, b: string, bPort: number, length = 5): NetLink => ({ paid: 0,
  uid,
  cable: 'utp_cat5e',
  a: { node: a, port: aPort },
  b: { node: b, port: bPort },
  path: [
    [0, 0],
    [length, 0],
  ],
});

describe('linkLength', () => {
  it('折れ点ごとの距離を合計する', () => {
    expect(
      linkLength([
        [0, 0],
        [3, 0],
        [3, 4],
      ]),
    ).toBe(7);
  });
});

describe('ping: L1 / L2 / L3', () => {
  it('同じサブネットの2台を直結すると通る', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.10'), pc('b', '192.168.1.11')],
      links: [link('l1', 'a', 0, 'b', 0)],
    };
    const r = ping(net, data, 'a', 'b');
    expect(r.ok).toBe(true);
    expect(r.path).toEqual(['a', 'b']);
  });

  it('スイッチを経由して同じL2ドメインになると通る', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.10'), pc('b', '192.168.1.11'), sw('s')],
      links: [link('l1', 'a', 0, 's', 0), link('l2', 'b', 0, 's', 1)],
    };
    expect(ping(net, data, 'a', 'b').ok).toBe(true);
  });

  it('配線がないとlink.unplugged', () => {
    const net: Network = { nodes: [pc('a', '192.168.1.10'), pc('b', '192.168.1.11')], links: [] };
    expect(ping(net, data, 'a', 'b').failure).toMatchObject({ reason: 'link.unplugged', node: 'a' });
  });

  it('配線が上限長を超えるとlink.too_long', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.10'), pc('b', '192.168.1.11')],
      links: [link('l1', 'a', 0, 'b', 0, 31)],
    };
    expect(ping(net, data, 'a', 'b').failure?.reason).toBe('link.too_long');
  });

  it('スイッチどうしを2本の配線で二重につなぐと、ループして link.loop', () => {
    const base: Network = {
      nodes: [pc('a', '192.168.1.10'), pc('b', '192.168.1.11'), sw('s1'), sw('s2')],
      links: [link('l1', 'a', 0, 's1', 2), link('l2', 'b', 0, 's2', 2), link('l3', 's1', 0, 's2', 0)],
    };
    expect(ping(base, data, 'a', 'b').ok).toBe(true);
    const looped: Network = { ...base, links: [...base.links, link('l4', 's1', 1, 's2', 1)] };
    expect(ping(looped, data, 'a', 'b').failure?.reason).toBe('link.loop');
  });

  it('スイッチが3台で輪になっても link.loop', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.10'), pc('b', '192.168.1.11'), sw('s1'), sw('s2'), sw('s3')],
      links: [
        link('l1', 'a', 0, 's1', 2),
        link('l2', 'b', 0, 's2', 2),
        link('l3', 's1', 0, 's2', 0),
        link('l4', 's2', 1, 's3', 0),
        link('l5', 's3', 1, 's1', 1),
      ],
    };
    expect(ping(net, data, 'a', 'b').failure?.reason).toBe('link.loop');
  });

  it('輪になっていない木の形（スイッチを一列に並べる）は loop にならない', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.10'), pc('b', '192.168.1.11'), sw('s1'), sw('s2'), sw('s3')],
      links: [
        link('l1', 'a', 0, 's1', 2),
        link('l2', 'b', 0, 's3', 2),
        link('l3', 's1', 0, 's2', 0),
        link('l4', 's2', 1, 's3', 0),
      ],
    };
    expect(ping(net, data, 'a', 'b').ok).toBe(true);
  });

  it('IPアドレスが未設定ならip.unset', () => {
    const net: Network = {
      nodes: [pc('a', null), pc('b', '192.168.1.11')],
      links: [link('l1', 'a', 0, 'b', 0)],
    };
    expect(ping(net, data, 'a', 'b').failure).toMatchObject({ reason: 'ip.unset', node: 'a' });
  });

  it('同じL2ドメインに同じIPがあるとip.duplicate', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.10'), pc('b', '192.168.1.10'), pc('c', '192.168.1.11'), sw('s')],
      links: [link('l1', 'a', 0, 's', 0), link('l2', 'b', 0, 's', 1), link('l3', 'c', 0, 's', 2)],
    };
    expect(ping(net, data, 'c', 'a').failure?.reason).toBe('ip.duplicate');
  });

  it('同じサブネットでも別のL2ドメインならip.unreachable', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.10'), pc('b', '192.168.1.11'), sw('s'), sw('t')],
      links: [link('l1', 'a', 0, 's', 0), link('l2', 'b', 0, 't', 0)],
    };
    expect(ping(net, data, 'a', 'b').failure).toMatchObject({ reason: 'ip.unreachable', node: 'a' });
  });

  it('異なるサブネットでゲートウェイ未設定ならgateway.unset', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.10'), pc('b', '192.168.2.10')],
      links: [link('l1', 'a', 0, 'b', 0)],
    };
    expect(ping(net, data, 'a', 'b').failure?.reason).toBe('gateway.unset');
  });

  it('ルーターを経由して異なるサブネットに通る', () => {
    const net: Network = {
      nodes: [
        pc('a', '192.168.1.10', '192.168.1.1'),
        pc('b', '192.168.2.10', '192.168.2.1'),
        router('r', [
          { id: "g0/0", kind: "port", port: 0, ip: '192.168.1.1', prefix: 24 },
          { id: "g0/1", kind: "port", port: 1, ip: '192.168.2.1', prefix: 24 },
        ]),
      ],
      links: [link('l1', 'a', 0, 'r', 0), link('l2', 'r', 1, 'b', 0)],
    };
    const r = ping(net, data, 'a', 'b');
    expect(r.ok).toBe(true);
    expect(r.path).toEqual(['a', 'r', 'b']);
  });

  it('ゲートウェイのアドレスに誰もいないとgateway.unreachable', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.10', '192.168.1.1'), pc('b', '192.168.2.10', '192.168.2.1')],
      links: [link('l1', 'a', 0, 'b', 0)],
    };
    expect(ping(net, data, 'a', 'b').failure?.reason).toBe('gateway.unreachable');
  });

  it('ルーターに宛先へのルートがないとroute.none', () => {
    const net: Network = {
      nodes: [
        pc('a', '192.168.1.10', '192.168.1.1'),
        pc('b', '192.168.3.10', '192.168.3.1'),
        router('r', [
          { id: "g0/0", kind: "port", port: 0, ip: '192.168.1.1', prefix: 24 },
          { id: "g0/1", kind: "port", port: 1, ip: '192.168.2.1', prefix: 24 },
        ]),
      ],
      links: [link('l1', 'a', 0, 'r', 0), link('l2', 'r', 1, 'b', 0)],
    };
    expect(ping(net, data, 'a', 'b').failure).toMatchObject({ reason: 'route.none', node: 'r' });
  });

  it('静的ルートが互いを指すとroute.loop', () => {
    const net: Network = {
      nodes: [
        pc('a', '192.168.1.10', '192.168.1.1'),
        router(
          'r1',
          [
            { id: "g0/0", kind: "port", port: 0, ip: '192.168.1.1', prefix: 24 },
            { id: "g0/1", kind: "port", port: 1, ip: '10.0.0.1', prefix: 30 },
          ],
          [{ dest: '192.168.9.0', prefix: 24, nextHop: '10.0.0.2' }],
        ),
        router(
          'r2',
          [
            { id: "g0/0", kind: "port", port: 0, ip: '10.0.0.2', prefix: 30 },
            { id: "g0/1", kind: "port", port: 1, ip: '10.0.1.1', prefix: 30 },
          ],
          [{ dest: '192.168.9.0', prefix: 24, nextHop: '10.0.0.1' }],
        ),
        pc('z', '192.168.9.5', '192.168.9.1'),
      ],
      links: [link('l1', 'a', 0, 'r1', 0), link('l2', 'r1', 1, 'r2', 0), link('l3', 'r2', 1, 'z', 0)],
    };
    expect(ping(net, data, 'a', 'z').failure?.reason).toBe('route.loop');
  });
});

describe('ping: 復路', () => {
  it('往路は通り、復路のゲートウェイ未設定でreturn.failed', () => {
    const net: Network = {
      nodes: [
        pc('a', '192.168.1.10', '192.168.1.1'),
        pc('b', '192.168.2.10'),
        router('r', [
          { id: "g0/0", kind: "port", port: 0, ip: '192.168.1.1', prefix: 24 },
          { id: "g0/1", kind: "port", port: 1, ip: '192.168.2.1', prefix: 24 },
        ]),
      ],
      links: [link('l1', 'a', 0, 'r', 0), link('l2', 'r', 1, 'b', 0)],
    };
    const r = ping(net, data, 'a', 'b');
    expect(r.ok).toBe(false);
    expect(r.failure).toMatchObject({ reason: 'return.failed', node: 'b' });
    expect(r.failure?.cause).toMatchObject({ reason: 'gateway.unset', node: 'b' });
  });
});

describe('http', () => {
  it('ポートで待ち受けていれば通る', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.10'), server('w', '192.168.1.20', [{ protocol: 'http', port: 80 }])],
      links: [link('l1', 'a', 0, 'w', 0)],
    };
    expect(http(net, data, 'a', 'w', 80).ok).toBe(true);
  });

  it('待ち受けていないポートならservice.closed', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.10'), server('w', '192.168.1.20', [{ protocol: 'http', port: 80 }])],
      links: [link('l1', 'a', 0, 'w', 0)],
    };
    expect(http(net, data, 'a', 'w', 8080).failure).toMatchObject({ reason: 'service.closed', node: 'w' });
  });
});

describe('輪の検出（社内の表示に使う）', () => {
  it('輪がなければ null、輪があれば輪の中のスイッチの uid を返す', () => {
    const tree: Network = { nodes: [sw('s1'), sw('s2'), pc('a', null)], links: [link('l1', 'a', 0, 's1', 2), link('l2', 's1', 0, 's2', 0)] };
    expect(loopNodeOf(tree, data)).toBeNull();
    const looped: Network = { ...tree, links: [...tree.links, link('l3', 's1', 1, 's2', 1)] };
    expect(['s1', 's2']).toContain(loopNodeOf(looped, data));
  });
});
