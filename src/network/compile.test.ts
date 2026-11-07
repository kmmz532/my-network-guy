import { describe, expect, it } from 'vitest';
import { compile } from './compile';
import { ping } from './engine';
import type { EngineData, Iface, NetLink, NetNode, Network, Route, SegmentConfig } from './types';

const data: EngineData = {
  categoryOf: (device) => ({ pc: 'pc', l2: 'l2_switch', router: 'router' })[device] ?? 'unknown',
  maxLengthOf: () => 100,
};

const node = (uid: string, device: string, interfaces: Iface[] = []): NetNode => ({
  uid,
  device,
  x: 0,
  y: 0,
  locked: false,
  configLocked: false,
  interfaces,
  gateway: null,
  routes: [],
  services: [],
});

const pc = (uid: string, ip?: string): NetNode => node(uid, 'pc', ip ? [{ id: "g0/0", kind: "port", port: 0, ip, prefix: 24 }] : []);
const sw = (uid: string): NetNode => node(uid, 'l2');
const router = (uid: string, ifaces: Iface[] = [], routes: Route[] = []): NetNode => ({
  ...node(uid, 'router', ifaces),
  routes,
});

// 配線（端点は "uid:port" で指定する）
const link = (uid: string, a: string, b: string): NetLink => {
  const [an, ap] = a.split(':');
  const [bn, bp] = b.split(':');
  return {
    uid,
    cable: 'utp_cat5e',
    a: { node: an, port: Number(ap) },
    b: { node: bn, port: Number(bp) },
    paid: 0,
    path: [
      [0, 0],
      [1, 0],
    ],
  };
};

const seg = (network: string, prefix = 24): SegmentConfig => ({ network, prefix });

describe('セグメントの設定から機器の設定を作る', () => {
  it('同じセグメントのPCは、スイッチを経由して疎通する', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.11'), sw('s'), pc('b', '192.168.1.12')],
      links: [link('l0', 'a:0', 's:0'), link('l1', 's:1', 'b:0')],
      segments: { 'a:0': seg('192.168.1.0') },
    };
    const { net: out, issues } = compile(net, data);
    expect(issues).toEqual({});
    expect(ping(out, data, 'a', 'b').ok).toBe(true);
  });

  it('ホストのゲートウェイは、同じセグメントにあるルーターのアドレスになる', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.11'), router('r', [{ id: "g0/0", kind: "port", port: 0, ip: '192.168.1.1', prefix: 24 }])],
      links: [link('l0', 'a:0', 'r:0')],
      segments: { 'a:0': seg('192.168.1.0') },
    };
    const { net: out, issues } = compile(net, data);
    expect(issues).toEqual({});
    expect(out.nodes.find((n) => n.uid === 'a')?.gateway).toBe('192.168.1.1');
  });

  it('ルーターをまたぐ2つのセグメントは、ゲートウェイ経由で疎通する', () => {
    const net: Network = {
      nodes: [
        pc('a', '192.168.1.11'),
        router('r', [
          { id: "g0/0", kind: "port", port: 0, ip: '192.168.1.1', prefix: 24 },
          { id: "g0/1", kind: "port", port: 1, ip: '192.168.2.1', prefix: 24 },
        ]),
        pc('c', '192.168.2.11'),
      ],
      links: [link('l0', 'a:0', 'r:0'), link('l1', 'r:1', 'c:0')],
      segments: { 'a:0': seg('192.168.1.0'), 'c:0': seg('192.168.2.0') },
    };
    const { net: out, issues } = compile(net, data);
    expect(issues).toEqual({});
    expect(ping(out, data, 'a', 'c').ok).toBe(true);
  });

  it('ルーターの静的ルートは、保存されたものをそのまま使う', () => {
    const route: Route = { dest: '10.0.0.0', prefix: 8, nextHop: '192.168.1.2' };
    const net: Network = {
      nodes: [router('r', [{ id: "g0/0", kind: "port", port: 0, ip: '192.168.1.1', prefix: 24 }], [route])],
      links: [],
    };
    expect(compile(net, data).net.nodes[0].routes).toEqual([route]);
  });

  it('IPアドレスの設定とプレフィックスは、セグメントの設定に従う', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.11'), pc('b', '192.168.1.12')],
      links: [link('l0', 'a:0', 'b:0')],
      segments: { 'a:0': seg('192.168.1.0', 25) },
    };
    const { net: out } = compile(net, data);
    expect(out.nodes.find((n) => n.uid === 'a')?.interfaces[0].prefix).toBe(25);
  });
});

describe('機器の不備（issues）', () => {
  it('IPアドレスのないPCは ip.unset になる（配線していなくても）', () => {
    const net: Network = { nodes: [pc('a')], links: [] };
    expect(compile(net, data).issues).toEqual({ a: { reason: 'ip.unset' } });
  });

  it('セグメントに設定がなければ segment.unset になる', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.11'), pc('b', '192.168.1.12')],
      links: [link('l0', 'a:0', 'b:0')],
    };
    expect(compile(net, data).issues).toEqual({
      a: { reason: 'segment.unset', ip: '192.168.1.11' },
      b: { reason: 'segment.unset', ip: '192.168.1.12' },
    });
  });

  it('アドレスがセグメントの範囲外なら ip.out_of_segment になる', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.2.11'), pc('b', '192.168.1.12')],
      links: [link('l0', 'a:0', 'b:0')],
      segments: { 'a:0': seg('192.168.1.0') },
    };
    expect(compile(net, data).issues.a).toEqual({ reason: 'ip.out_of_segment', ip: '192.168.2.11', segment: '192.168.1.0/24' });
  });

  it('ホスト数に対してアドレスが足りないと segment.too_small になる', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.1'), pc('b', '192.168.1.2'), pc('c', '192.168.1.3'), sw('s')],
      links: [link('l0', 'a:0', 's:0'), link('l1', 'b:0', 's:1'), link('l2', 'c:0', 's:2')],
      // /30 は使えるアドレスが2つだけ
      segments: { 'a:0': seg('192.168.1.0', 30) },
    };
    const { issues } = compile(net, data);
    expect(issues).toEqual({
      a: { reason: 'segment.too_small', segment: '192.168.1.0/30' },
      b: { reason: 'segment.too_small', segment: '192.168.1.0/30' },
      c: { reason: 'segment.too_small', segment: '192.168.1.0/30' },
    });
  });

  it('アドレスの範囲が重なるセグメントは segment.overlap になる', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.11'), pc('b', '192.168.1.12'), pc('c', '192.168.1.21'), pc('d', '192.168.1.22')],
      links: [link('l0', 'a:0', 'b:0'), link('l1', 'c:0', 'd:0')],
      segments: { 'a:0': seg('192.168.1.0', 24), 'c:0': seg('192.168.1.0', 25) },
    };
    const { issues } = compile(net, data);
    expect(Object.values(issues).map((i) => i.reason)).toEqual(['segment.overlap', 'segment.overlap', 'segment.overlap', 'segment.overlap']);
  });

  it('固定されたホストのゲートウェイがルーターのアドレスと違うと gateway.mismatch になる', () => {
    const fixedPc: NetNode = {
      ...pc('a', '192.168.1.11'),
      configLocked: true,
      gateway: '192.168.1.2',
    };
    const net: Network = {
      nodes: [fixedPc, router('r', [{ id: "g0/0", kind: "port", port: 0, ip: '192.168.1.1', prefix: 24 }])],
      links: [link('l0', 'a:0', 'r:0')],
    };
    const { net: out, issues } = compile(net, data);
    expect(issues.a).toEqual({ reason: 'gateway.mismatch', gateway: '192.168.1.2', ip: '192.168.1.1' });
    // 固定されたゲートウェイは変えない
    expect(out.nodes.find((n) => n.uid === 'a')?.gateway).toBe('192.168.1.2');
  });

  it('セグメントが2つ以上あって同じセグメントにルーターがなければ gateway.unset になる', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.11'), pc('b', '192.168.1.12'), pc('c', '192.168.2.11'), pc('d', '192.168.2.12')],
      links: [link('l0', 'a:0', 'b:0'), link('l1', 'c:0', 'd:0')],
      segments: { 'a:0': seg('192.168.1.0'), 'c:0': seg('192.168.2.0') },
    };
    const { issues } = compile(net, data);
    expect(Object.keys(issues).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(Object.values(issues).every((i) => i.reason === 'gateway.unset')).toBe(true);
  });

  it('1つだけのセグメントでルーターがなくても、ゲートウェイの不備にはしない', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.11'), pc('b', '192.168.1.12')],
      links: [link('l0', 'a:0', 'b:0')],
      segments: { 'a:0': seg('192.168.1.0') },
    };
    expect(compile(net, data).issues).toEqual({});
  });
});
