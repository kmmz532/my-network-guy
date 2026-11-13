import { describe, expect, it } from 'vitest';
import { NET_PALETTE, UNSET_COLOR, colorOfLink, colorOfNetwork, networkLabelOf } from './netColor';
import { networkColors } from './query/networkColors';
import { analyze } from './engine/analyze';
import { neighborRouterAddresses, routerAddressesOn } from './segments';
import type { Iface } from './types';
import type { EngineData, NetLink, NetNode, Network } from './types';

const data: EngineData = { wallAt: () => false };

const node = (uid: string, device: string, ifaces: Iface[] = []): NetNode => ({ ports: [],
  uid,
  device,
  x: 0,
  y: 0,
  locked: false,
  configLocked: false,
  interfaces: ifaces,
  gateway: null,
  routes: [],
  services: [],
});

const link = (uid: string, a: [string, number], b: [string, number]): NetLink => ({ paid: 0,
  uid,
  cable: 'utp_cat5e',
  a: { node: a[0], port: a[1] },
  b: { node: b[0], port: b[1] },
  path: [],
});

describe('ネットワークごとの色', () => {
  it('設定されたネットワークを、アドレスの小さい順にパレットの色で割り当てる', () => {
    const net: Network = {
      nodes: [
        node('pc_a', 'pc_basic', [{ id: "g0/0", kind: "port", port: 0, ip: '192.168.1.11', prefix: 24 }]),
        node('pc_b', 'pc_basic', [{ id: "g0/0", kind: "port", port: 0, ip: '192.168.1.12', prefix: 24 }]),
        node('pc_c', 'pc_basic', [{ id: "g0/0", kind: "port", port: 0, ip: '10.0.0.5', prefix: 24 }]),
        node('pc_d', 'pc_basic', [{ id: "g0/0", kind: "port", port: 0, ip: '10.0.0.6', prefix: 24 }]),
      ],
      links: [link('l0', ['pc_a', 0], ['pc_b', 0]), link('l1', ['pc_c', 0], ['pc_d', 0])],
      segments: { 'pc_a:0': { network: '192.168.1.0', prefix: 24 }, 'pc_c:0': { network: '10.0.0.0', prefix: 24 } },
    };
    const colors = networkColors(analyze(net, data));
    expect(colors.index.get('10.0.0.0')).toBe(0);
    expect(colors.index.get('192.168.1.0')).toBe(1);
    expect(colorOfLink(colors, 'l0')).toBe(NET_PALETTE[1]);
    expect(colorOfLink(colors, 'l1')).toBe(NET_PALETTE[0]);
    expect(networkLabelOf(colors, '192.168.1.0')).toBe('192.168.1.0/24');
  });

  it('パレットを使い切ったら、番号を循環させる', () => {
    expect(colorOfNetwork({ index: new Map([['x', 6]]), linkNetwork: new Map() }, 'x')).toBe(NET_PALETTE[0]);
  });

  it('アドレスの未設定の機器がつながるケーブルは灰色になる', () => {
    const net: Network = {
      nodes: [node('pc_a', 'pc_basic', [{ id: "g0/0", kind: "port", port: 0, ip: '192.168.1.11', prefix: 24 }]), node('pc_b', 'pc_basic')],
      links: [link('l0', ['pc_a', 0], ['pc_b', 0])],
      segments: { 'pc_a:0': { network: '192.168.1.0', prefix: 24 } },
    };
    const colors = networkColors(analyze(net, data));
    expect(colors.linkNetwork.get('l0')).toBeNull();
    expect(colorOfLink(colors, 'l0')).toBe(UNSET_COLOR);
  });

  it('両端の機器のアドレスが食い違うケーブルは灰色になる', () => {
    const net: Network = {
      nodes: [
        node('pc_a', 'pc_basic', [{ id: "g0/0", kind: "port", port: 0, ip: '192.168.1.11', prefix: 24 }]),
        node('pc_b', 'pc_basic', [{ id: "g0/0", kind: "port", port: 0, ip: '10.0.0.12', prefix: 24 }]),
      ],
      links: [link('l0', ['pc_a', 0], ['pc_b', 0])],
      segments: { 'pc_a:0': { network: '192.168.1.0', prefix: 24 } },
    };
    expect(colorOfLink(networkColors(analyze(net, data)), 'l0')).toBe(UNSET_COLOR);
  });

  it('スイッチを挟んでも、ホストのアドレスで色が決まる', () => {
    const net: Network = {
      nodes: [
        node('pc_a', 'pc_basic', [{ id: "g0/0", kind: "port", port: 0, ip: '192.168.1.11', prefix: 24 }]),
        node('pc_b', 'pc_basic', [{ id: "g0/0", kind: "port", port: 0, ip: '192.168.1.12', prefix: 24 }]),
        node('sw', 'l2_switch_8p'),
      ],
      links: [link('l0', ['pc_a', 0], ['sw', 0]), link('l1', ['pc_b', 0], ['sw', 1])],
      segments: { 'pc_a:0': { network: '192.168.1.0', prefix: 24 } },
    };
    const colors = networkColors(analyze(net, data));
    expect(colorOfLink(colors, 'l0')).toBe(NET_PALETTE[0]);
    expect(colorOfLink(colors, 'l1')).toBe(NET_PALETTE[0]);
  });

  it('ルーター–スイッチ–PCで、ケーブルの a がスイッチ側でも色が付く', () => {
    // a がスイッチ側（sw:0 → rt:0、sw:1 → pc_a:0）と、a がルーター・PC側の両方を並べる
    const nodes = [
      node('pc_a', 'pc_basic', [{ id: "g0/0", kind: "port", port: 0, ip: '192.168.1.11', prefix: 24 }]),
      node('rt', 'router_basic', [{ id: "g0/0", kind: "port", port: 0, ip: '192.168.1.1', prefix: 24 }]),
      node('sw', 'l2_switch_8p'),
    ];
    const segments = { 'pc_a:0': { network: '192.168.1.0', prefix: 24 } };
    const swSideA: Network = {
      nodes,
      links: [link('l0', ['sw', 0], ['rt', 0]), link('l1', ['sw', 1], ['pc_a', 0])],
      segments,
    };
    const routerSideA: Network = {
      nodes,
      links: [link('l0', ['rt', 0], ['sw', 0]), link('l1', ['pc_a', 0], ['sw', 1])],
      segments,
    };
    for (const net of [swSideA, routerSideA]) {
      const colors = networkColors(analyze(net, data));
      expect(colorOfLink(colors, 'l0')).toBe(NET_PALETTE[0]);
      expect(colorOfLink(colors, 'l1')).toBe(NET_PALETTE[0]);
      expect(colors.linkNetwork.get('l0')).toBe('192.168.1.0');
      expect(colors.linkNetwork.get('l1')).toBe('192.168.1.0');
    }
  });

  it('PC–スイッチで、ケーブルの a がスイッチ側でも色が付く', () => {
    const net: Network = {
      nodes: [
        node('pc_a', 'pc_basic', [{ id: "g0/0", kind: "port", port: 0, ip: '192.168.1.11', prefix: 24 }]),
        node('pc_b', 'pc_basic', [{ id: "g0/0", kind: "port", port: 0, ip: '192.168.1.12', prefix: 24 }]),
        node('sw', 'l2_switch_8p'),
      ],
      links: [link('l0', ['sw', 0], ['pc_a', 0]), link('l1', ['sw', 1], ['pc_b', 0])],
      segments: { 'pc_a:0': { network: '192.168.1.0', prefix: 24 } },
    };
    const colors = networkColors(analyze(net, data));
    expect(colorOfLink(colors, 'l0')).toBe(NET_PALETTE[0]);
    expect(colorOfLink(colors, 'l1')).toBe(NET_PALETTE[0]);
  });
});

describe('ルーターのアドレスの候補', () => {
  // PC（pc_a）のセグメントに、ルーターのポート（rt:0）と、もう1台のルーター（rt2:0）がある
  const net: Network = {
    nodes: [
      node('pc_a', 'pc_basic', [{ id: "g0/0", kind: "port", port: 0, ip: '192.168.1.11', prefix: 24 }]),
      node('rt', 'router_basic', [{ id: "g0/0", kind: "port", port: 0, ip: '192.168.1.1', prefix: 24 }, { id: "g0/1", kind: "port", port: 1, ip: '10.0.0.1', prefix: 24 }]),
      node('rt2', 'router_basic', [{ id: "g0/0", kind: "port", port: 0, ip: '10.0.0.2', prefix: 24 }]),
    ],
    links: [link('l0', ['pc_a', 0], ['rt', 0]), link('l1', ['rt', 1], ['rt2', 0])],
  };

  it('ホストと同じセグメントのルーターのアドレスを候補にする', () => {
    expect(routerAddressesOn(analyze(net, data).l2.segments, net, 'pc_a', 0)).toEqual(['192.168.1.1']);
  });

  it('ルーターがいないセグメントの候補は空になる', () => {
    const noRouter: Network = { nodes: [node('pc_a', 'pc_basic', [{ id: "g0/0", kind: "port", port: 0, ip: '192.168.9.11', prefix: 24 }]), node('pc_b', 'pc_basic')], links: [link('l0', ['pc_a', 0], ['pc_b', 0])] };
    expect(routerAddressesOn(analyze(noRouter, data).l2.segments, noRouter, 'pc_a', 0)).toEqual([]);
  });

  it('ネクストホップは、つながるセグメントにいるほかのルーターのアドレス', () => {
    expect(neighborRouterAddresses(analyze(net, data).l2.segments, net, 'rt')).toEqual(['10.0.0.2']);
  });
});
