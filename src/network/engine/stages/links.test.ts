// 配線の層: 無線の仮想の配線・論理リンク・停止した口・長さの超過
import { describe, expect, it } from 'vitest';
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
      nodes: [node('ap', 'access_point', 1, { x: 2, wireless: wifi }), node('lap', 'laptop', 2, { x: 4, wireless: wifi })],
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
      nodes: [node('ap', 'access_point', 1, { x: 2, wireless: wifi }), node('lap', 'laptop', 2, { x: 4, wireless: wifi }), node('pc', 'pc_basic', 3)],
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
