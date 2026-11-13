import { analyze } from '../analyze';
import { describe, expect, it } from 'vitest';
import { ping } from '../../engine';
import type { EngineData, Iface, NetLink, NetNode, Network, Route, NetworkPlan } from '../../types';

const data: EngineData = { wallAt: () => false };

// アドレスの層の補完した構成と不備
const addressing = (net: Network) => {
  const layer = analyze(net, data).addressing;
  return { net: layer.completed, issues: layer.issues };
};

const node = (uid: string, device: string, interfaces: Iface[] = []): NetNode => ({ ports: [],
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

const pc = (uid: string, ip?: string): NetNode => node(uid, 'pc_basic', ip ? [{ id: "g0/0", kind: "port", port: 0, ip, prefix: 24 }] : []);
const sw = (uid: string): NetNode => node(uid, 'l2_switch_8p');
const router = (uid: string, ifaces: Iface[] = [], routes: Route[] = []): NetNode => ({
  ...node(uid, 'router_basic', ifaces),
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

const seg = (network: string, prefix = 24): NetworkPlan => ({ network, prefix });

describe('セグメントの設定から機器の設定を作る', () => {
  it('同じセグメントのPCは、スイッチを経由して疎通する', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.11'), sw('s'), pc('b', '192.168.1.12')],
      links: [link('l0', 'a:0', 's:0'), link('l1', 's:1', 'b:0')],
      plans: { 'a:0': seg('192.168.1.0') },
    };
    const { net: out, issues } = addressing(net);
    expect(issues).toEqual({});
    expect(ping(analyze(out, data), 'a', 'b').ok).toBe(true);
  });

  it('ホストのゲートウェイは、同じセグメントにあるルーターのアドレスになる', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.11'), router('r', [{ id: "g0/0", kind: "port", port: 0, ip: '192.168.1.1', prefix: 24 }])],
      links: [link('l0', 'a:0', 'r:0')],
      plans: { 'a:0': seg('192.168.1.0') },
    };
    const { net: out, issues } = addressing(net);
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
      plans: { 'a:0': seg('192.168.1.0'), 'c:0': seg('192.168.2.0') },
    };
    const { net: out, issues } = addressing(net);
    expect(issues).toEqual({});
    expect(ping(analyze(out, data), 'a', 'c').ok).toBe(true);
  });

  it('ルーターの静的ルートは、保存されたものをそのまま使う', () => {
    const route: Route = { dest: '10.0.0.0', prefix: 8, nextHop: '192.168.1.2' };
    const net: Network = {
      nodes: [router('r', [{ id: "g0/0", kind: "port", port: 0, ip: '192.168.1.1', prefix: 24 }], [route])],
      links: [],
    };
    expect(addressing(net).net.nodes[0].routes).toEqual([route]);
  });

  it('IPアドレスの設定とプレフィックスは、セグメントの設定に従う', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.11'), pc('b', '192.168.1.12')],
      links: [link('l0', 'a:0', 'b:0')],
      plans: { 'a:0': seg('192.168.1.0', 25) },
    };
    const { net: out } = addressing(net);
    expect(out.nodes.find((n) => n.uid === 'a')?.interfaces[0].prefix).toBe(25);
  });
});

describe('機器の不備（issues）', () => {
  it('IPアドレスのないPCは ip.unset になる（配線していなくても）', () => {
    const net: Network = { nodes: [pc('a')], links: [] };
    expect(addressing(net).issues).toEqual({ a: { reason: 'ip.unset' } });
  });

  it('セグメントに設定がなければ segment.unset になる', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.11'), pc('b', '192.168.1.12')],
      links: [link('l0', 'a:0', 'b:0')],
    };
    expect(addressing(net).issues).toEqual({
      a: { reason: 'segment.unset', ip: '192.168.1.11' },
      b: { reason: 'segment.unset', ip: '192.168.1.12' },
    });
  });

  it('アドレスがセグメントの範囲外なら ip.out_of_segment になる', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.2.11'), pc('b', '192.168.1.12')],
      links: [link('l0', 'a:0', 'b:0')],
      plans: { 'a:0': seg('192.168.1.0') },
    };
    expect(addressing(net).issues.a).toEqual({ reason: 'ip.out_of_segment', ip: '192.168.2.11', segment: '192.168.1.0/24' });
  });

  it('ホスト数に対してアドレスが足りないと segment.too_small になる', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.1'), pc('b', '192.168.1.2'), pc('c', '192.168.1.3'), sw('s')],
      links: [link('l0', 'a:0', 's:0'), link('l1', 'b:0', 's:1'), link('l2', 'c:0', 's:2')],
      // /30 は使えるアドレスが2つだけ
      plans: { 'a:0': seg('192.168.1.0', 30) },
    };
    const { issues } = addressing(net);
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
      plans: { 'a:0': seg('192.168.1.0', 24), 'c:0': seg('192.168.1.0', 25) },
    };
    const { issues } = addressing(net);
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
    const { net: out, issues } = addressing(net);
    expect(issues.a).toEqual({ reason: 'gateway.mismatch', gateway: '192.168.1.2', ip: '192.168.1.1' });
    // 固定されたゲートウェイは変えない
    expect(out.nodes.find((n) => n.uid === 'a')?.gateway).toBe('192.168.1.2');
  });

  it('セグメントが2つ以上あって同じセグメントにルーターがなければ gateway.unset になる', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.11'), pc('b', '192.168.1.12'), pc('c', '192.168.2.11'), pc('d', '192.168.2.12')],
      links: [link('l0', 'a:0', 'b:0'), link('l1', 'c:0', 'd:0')],
      plans: { 'a:0': seg('192.168.1.0'), 'c:0': seg('192.168.2.0') },
    };
    const { issues } = addressing(net);
    expect(Object.keys(issues).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(Object.values(issues).every((i) => i.reason === 'gateway.unset')).toBe(true);
  });

  it('1つだけのセグメントでルーターがなくても、ゲートウェイの不備にはしない', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.11'), pc('b', '192.168.1.12')],
      links: [link('l0', 'a:0', 'b:0')],
      plans: { 'a:0': seg('192.168.1.0') },
    };
    expect(addressing(net).issues).toEqual({});
  });
  it('設定を固定したルーターの既定のゲートウェイは残し、固定しないルーターでは消す', () => {
    const fixedRouter = { ...router('r1', [{ id: 'g0/0', kind: 'port', port: 0, ip: '203.0.113.1', prefix: 24 }]), gateway: '203.0.113.2', configLocked: true };
    const freeRouter = { ...router('r2', [{ id: 'g0/0', kind: 'port', port: 0, ip: '203.0.113.3', prefix: 24 }]), gateway: '203.0.113.2' };
    const out = addressing({ nodes: [fixedRouter, freeRouter], links: [], plans: {} }).net.nodes;
    expect(out.find((n) => n.uid === 'r1')?.gateway).toBe('203.0.113.2');
    expect(out.find((n) => n.uid === 'r2')?.gateway).toBeNull();
  });
});

describe('アドレスの層', () => {
  const layerOf = (net: Network) => analyze(net, data).addressing;
  const auto = (uid: string): NetNode => ({ ...node(uid, 'pc_basic', [{ id: 'eth0', kind: 'port', port: 0, ip: '', prefix: 24, dhcp: true }]), macSerial: 1 });
  const pool = (n: number) => ({ network: `192.168.${n}.0`, prefix: 24, start: `192.168.${n}.100`, end: `192.168.${n}.110`, gateway: `192.168.${n}.1` });

  it('L2 スイッチの口に入ったアドレスは除く', () => {
    const s = node('s', 'l2_switch_8p', [{ id: 'g0/0', kind: 'port', port: 0, ip: '192.168.1.5', prefix: 24 }]);
    const layer = layerOf({ nodes: [pc('a', '192.168.1.11'), s], links: [link('l0', 'a:0', 's:1')], plans: { 'a:0': seg('192.168.1.0') } });
    expect(layer.net.nodes.find((n) => n.uid === 's')?.interfaces).toEqual([]);
  });

  it('同じドメインの DHCP サーバーから、プールの最も小さいアドレスとゲートウェイを受け取る', () => {
    const srv: NetNode = { ...node('srv', 'server_basic', [{ id: 'eth0', kind: 'port', port: 0, ip: '192.168.1.2', prefix: 24 }]), dhcpPools: [pool(1)] };
    const layer = layerOf({ nodes: [auto('a'), sw('s'), srv], links: [link('l0', 'a:0', 's:0'), link('l1', 'srv:0', 's:1')], plans: {} });
    expect(layer.dhcp.leases).toEqual([{ uid: 'a', port: 0, ip: '192.168.1.100', prefix: 24, gateway: '192.168.1.1', server: 'srv' }]);
    const a = layer.net.nodes.find((n) => n.uid === 'a');
    expect([a?.interfaces[0].ip, a?.gateway]).toEqual(['192.168.1.100', '192.168.1.1']);
  });

  it('DHCP のリレーは、ルーターからサーバーへ届くときだけ、サーバーのプールから配る', () => {
    const srv: NetNode = { ...node('srv', 'server_basic', [{ id: 'eth0', kind: 'port', port: 0, ip: '10.0.0.2', prefix: 24 }]), dhcpPools: [pool(2)] };
    const r = router('r', [
      { id: 'g0/0', kind: 'port', port: 0, ip: '10.0.0.1', prefix: 24 },
      { id: 'g0/1', kind: 'port', port: 1, ip: '192.168.2.1', prefix: 24, helper: '10.0.0.2' },
    ]);
    const nodes = [auto('a'), r, srv];
    const reached = layerOf({ nodes, links: [link('l0', 'a:0', 'r:1'), link('l1', 'r:0', 'srv:0')], plans: {} });
    expect(reached.dhcp.leases.map((l) => [l.uid, l.ip, l.server])).toEqual([['a', '192.168.2.100', 'srv']]);
    // サーバーへの配線がなければ、リレーは届かない
    const cut = layerOf({ nodes, links: [link('l0', 'a:0', 'r:1')], plans: {} });
    expect(cut.dhcp.failed).toEqual([{ uid: 'a', port: 0, reason: 'dhcp.no_offer' }]);
  });

  it('VRRP の持ち主は、同じドメインで有効な優先度の最も高いルーター', () => {
    const vr = (uid: string, ip: string, priority: number) => router(uid, [{ id: 'g0/0', kind: 'port', port: 0, ip, prefix: 24, vrrp: [{ vrid: 1, ip: '192.168.1.1', priority, preempt: true }] }]);
    const layer = layerOf({
      nodes: [pc('a', '192.168.1.11'), sw('s'), vr('r1', '192.168.1.2', 110), vr('r2', '192.168.1.3', 100)],
      links: [link('l0', 'a:0', 's:0'), link('l1', 'r1:0', 's:1'), link('l2', 'r2:0', 's:2')],
      plans: { 'a:0': seg('192.168.1.0') },
    });
    expect([layer.vrrpOwns('r1', 0, '192.168.1.1'), layer.vrrpOwns('r2', 0, '192.168.1.1')]).toEqual([true, false]);
  });
});
