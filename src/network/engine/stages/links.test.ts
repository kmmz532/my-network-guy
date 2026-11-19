// 配線の層: 無線の仮想の配線・論理リンク・停止した口・長さの超過
import { describe, expect, it, vi } from 'vitest';
import { registries } from '../../../registry/game';
import { warningsOf } from '../../query/warnings';
import { gameEnv } from '../../../sim/env';
import { cableMaxLength } from '../../../registry/query';
import type { Iface, NetLink, NetNode, Network, PortConfig } from '../../types';
import { stageLinks } from './links';
import { analyze } from '../analyze';
import { planDomainOf, planOf } from '../../query/plans';

const world = gameEnv.engine;
const node = (uid: string, device: string, serial: number, extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device, macSerial: serial, x: 0, y: 0, locked: false, configLocked: false, interfaces: [] as Iface[], gateway: null, routes: [], services: [], ports: [], ...extra }) as NetNode;
const link = (uid: string, a: string, pa: number, b: string, pb: number, path: [number, number][] = [[0, 0], [1, 0]]): NetLink =>
  ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path, paid: 0 });
const lag = (port: number): PortConfig => ({ port, mode: 'access', channelGroup: 1, lacp: 'active' });

describe('stageLinks', () => {
  it('無線の端末は、アクセスポイントへの仮想の配線として現れる', () => {
    const wifi = { ssid: 'home', password: 'pass1234' };
    const net: Network = {
      nodes: [node('ap', 'access_point', 1, { x: 2, components: { wireless: { ...wifi, band: '2.4' as const } } }), node('lap', 'laptop', 2, { x: 4, components: { wireless: wifi } })],
      links: [],
      plans: {},
    };
    const layer = stageLinks(net, world);
    expect(layer.associations.map((p) => [p.ap.uid, p.client.uid])).toEqual([['ap', 'lap']]);
    expect(layer.net.links.map((l) => l.uid)).toEqual(['__wifi_lap']);
  });

  it('無線の端末は、アクセスポイントの L2 ドメインの計画を引く（鍵には使わない）', () => {
    const wifi = { ssid: 'home', password: 'pass1234' };
    const net: Network = {
      nodes: [node('ap', 'access_point', 1, { x: 2, components: { wireless: { ...wifi, band: '2.4' as const } } }), node('lap', 'laptop', 2, { x: 4, components: { wireless: wifi } }), node('pc', 'pc_basic', 3)],
      links: [link('w', 'pc', 0, 'ap', 0)],
      plans: { 'pc:0': { network: '192.168.1.0', prefix: 24 } },
    };
    const state = analyze(net, world);
    expect(planDomainOf(state, { node: 'lap', port: 0 })).toEqual({ key: 'pc:0', members: [{ node: 'pc', port: 0 }], wireless: [{ node: 'lap', port: 0 }] });
    expect(planOf(state, { node: 'lap', port: 0 })).toEqual({ network: '192.168.1.0', prefix: 24 });
  });

  it('同じ2台の間の2本の配線は、1つの論理リンクにまとまる', () => {
    const net: Network = {
      nodes: [node('sw1', 'l2_switch_8p', 1, { ports: [lag(0), lag(1)] }), node('sw2', 'l2_switch_8p', 2, { ports: [lag(0), lag(1)] })],
      links: [link('x', 'sw1', 0, 'sw2', 0), link('y', 'sw1', 1, 'sw2', 1)],
      plans: {},
    };
    const layer = stageLinks(net, world);
    expect(layer.lag.bundles).toHaveLength(1);
    expect(layer.lag.bundles[0].links.map((l) => l.uid).sort()).toEqual(['x', 'y']);
  });

  it('shutdown の口と電源を切った機器の口は停止する', () => {
    const net: Network = {
      nodes: [
        node('sw1', 'l2_switch_8p', 1, { ports: [{ port: 0, mode: 'access', shutdown: true }] }),
        node('sw2', 'l2_switch_8p', 2, { powered: false }),
      ],
      links: [link('x', 'sw1', 0, 'sw2', 0)],
      plans: {},
    };
    const layer = stageLinks(net, world);
    expect(layer.isShut('sw1', 0)).toBe(true);
    expect(layer.isShut('sw1', 1)).toBe(false);
    expect(layer.isShut('sw2', 3)).toBe(true);
  });

  it('上限の長さを超えた配線は、tooLong に入る', () => {
    const far = cableMaxLength('utp_cat5e') + 1;
    const net: Network = {
      nodes: [node('sw1', 'l2_switch_8p', 1), node('sw2', 'l2_switch_8p', 2)],
      links: [link('near', 'sw1', 0, 'sw2', 0), link('far', 'sw1', 1, 'sw2', 1, [[0, 0], [far, 0]])],
      plans: {},
    };
    const layer = stageLinks(net, world);
    expect([...layer.tooLong]).toEqual(['far']);
  });
});

describe('リンクの速さ', () => {
  const sw = (uid: string, serial: number, ports: PortConfig[] = []) => node(uid, 'l2_switch_8p', serial, { ports });
  const speedsWith = (portSpeeds: number | undefined, cableMbps: number | undefined, fn: () => void) => {
    const devices = registries.devices;
    const cables = registries.cables;
    const dGet = devices.get.bind(devices);
    const cGet = cables.get.bind(cables);
    const d = vi.spyOn(devices, 'get').mockImplementation((id) => (portSpeeds === undefined ? dGet(id) : { ...dGet(id), portSpeeds: dGet(id).portSpeeds.map(() => portSpeeds) }));
    const c = vi.spyOn(cables, 'get').mockImplementation((id) => (cableMbps === undefined ? cGet(id) : { ...cGet(id), bandwidthMbps: cableMbps }));
    try {
      fn();
    } finally {
      d.mockRestore();
      c.mockRestore();
    }
  };

  it('配線の速さは、両端の口とケーブルのうち最も遅いもの', () => {
    const net: Network = { nodes: [sw('a', 1), sw('b', 2)], links: [link('x', 'a', 0, 'b', 0)], plans: {} };
    speedsWith(1000, 100, () => expect(stageLinks(net, world).speeds.get('x')).toBe(100));
    speedsWith(100, 1000, () => expect(stageLinks(net, world).speeds.get('x')).toBe(100));
  });

  it('論理リンクの速さは、止まっていないメンバーの合計。1本止めると減る', () => {
    const net = (shutdown: boolean): Network => ({
      nodes: [sw('a', 1, [lag(0), { ...lag(1), shutdown }]), sw('b', 2, [lag(0), lag(1)])],
      links: [link('x', 'a', 0, 'b', 0), link('y', 'a', 1, 'b', 1)],
      plans: {},
    });
    speedsWith(1000, 1000, () => {
      expect(stageLinks(net(false), world).lagSpeeds.get('x')).toBe(2000);
      expect(stageLinks(net(true), world).lagSpeeds.get('x')).toBe(1000);
    });
  });

  it('警告 link.cable_bottleneck は、ケーブルが両端の口より遅いときだけ出る', () => {
    const net: Network = { nodes: [sw('a', 1), sw('b', 2)], links: [link('x', 'a', 0, 'b', 0)], plans: {} };
    speedsWith(1000, 100, () => expect(warningsOf(analyze(net, world))).toContainEqual({ id: 'link.cable_bottleneck', a: 'a', b: 'b' }));
    speedsWith(100, 1000, () => expect(warningsOf(analyze(net, world)).some((w) => w.id === 'link.cable_bottleneck')).toBe(false));
  });
});
