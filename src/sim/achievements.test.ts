// 自社の実績: 構成が論点を満たすと付き、壊すと外れる。判定は達成条件（evaluateGoal）を自社オフィスの構成に当てる
import { describe, expect, it } from 'vitest';
import type { Goal } from '../data/schema';
import type { Iface, NetLink, NetNode, PortConfig } from '../network/types';
import { achievedOf, proposalTopicOf, settleAchievements } from './achievements';
import { gameEnv } from './env';
import { emptyOffice, type Office } from './project';

const f = (port: number, ip: string, prefix = 24, nat?: 'inside' | 'outside'): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix, ...(nat ? { nat } : {}) });
const n = (uid: string, device: string, interfaces: Iface[], x: number, extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device, x, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports: [], macSerial: x + 1, ...extra }) as NetNode;
const l = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });
const officeOf = (nodes: NetNode[], links: NetLink[]): Office => ({ ...emptyOffice({ w: 10, h: 8 }), nodes, links });
const pc = (uid: string, ip: string, x: number, gateway: string | null = null) => n(uid, 'pc_basic', [f(0, ip)], x, { gateway });

// 回線終端 u - ルーター r（外 198.51.100.2・内 10.0.0.1）- スイッチ sw - サーバー srv と PC。公開するときは、80 番を srv へ静的 NAT で転送する
const dmzOffice = (published: boolean): Office =>
  officeOf(
    [
      n('u', 'uplink', [], 0),
      n('r', 'router_basic', [f(0, '198.51.100.2', 24, 'outside'), f(1, '10.0.0.1', 24, 'inside')], 1, {
        routes: [{ dest: '0.0.0.0', prefix: 0, nextHop: '198.51.100.1' }],
        components: { nat: { napt: true, statics: published ? [{ port: 80, insideIp: '10.0.0.10', insidePort: 80 }] : [] } },
      }),
      n('sw', 'l2_switch_8p', [], 2),
      n('srv', 'server_basic', [f(0, '10.0.0.10')], 3, { gateway: '10.0.0.1', services: [{ protocol: 'http', port: 80 }] }),
      pc('pc', '10.0.0.20', 4, '10.0.0.1'),
    ],
    [l('a', 'u', 0, 'r', 0), l('b', 'r', 1, 'sw', 0), l('c', 'srv', 0, 'sw', 1), l('d', 'pc', 0, 'sw', 2)],
  );

// スイッチ1台に PC 2台。VLAN は口ごとに指定する
const vlanOffice = (vlans: [number, number]): Office =>
  officeOf(
    [n('sw', 'l2_switch_8p', [], 0, { ports: vlans.map((vlan, port): PortConfig => ({ port, mode: 'access', vlan })) }), pc('a', '192.168.1.11', 1), pc('b', '192.168.1.12', 2)],
    [l('1', 'a', 0, 'sw', 0), l('2', 'b', 0, 'sw', 1)],
  );

// スイッチ3台の輪（ring）か、2台を経由する直線。PC は両端のスイッチに1台ずつ。輪のスイッチ core を STP のルートにする
const ringOffice = (ring: boolean): Office =>
  officeOf(
    [
      n('sw_a', 'l2_switch_8p', [], 0),
      n('sw_b', 'l2_switch_8p', [], 1),
      n('core', 'l2_switch_8p', [], 2, { components: { stp: { priority: 4096 } } }),
      pc('pc_a', '192.168.1.11', 3),
      pc('pc_b', '192.168.1.12', 4),
    ],
    [l('1', 'pc_a', 0, 'sw_a', 0), l('2', 'pc_b', 0, 'sw_b', 0), l('3', 'core', 0, 'sw_a', 1), l('4', 'core', 1, 'sw_b', 1), ...(ring ? [l('5', 'sw_a', 2, 'sw_b', 2)] : [])],
  );

describe('実績の判定', () => {
  it('dmz: 公開のサーバーに外から HTTP が届き、PC には届かないと付く。公開をやめると外れる', () => {
    expect(achievedOf(dmzOffice(true), gameEnv)).toContain('dmz');
    expect(achievedOf(dmzOffice(false), gameEnv)).not.toContain('dmz');
  });

  it('vlan_isolation: PC が2つの VLAN に分かれて通信できないと付く。同じ VLAN に戻すと外れる', () => {
    expect(achievedOf(vlanOffice([10, 20]), gameEnv)).toContain('vlan_isolation');
    expect(achievedOf(vlanOffice([10, 10]), gameEnv)).not.toContain('vlan_isolation');
  });

  it('redundancy: どの配線を1本外しても届く構成だと付く。輪をほどくと外れる', () => {
    expect(achievedOf(ringOffice(true), gameEnv)).toContain('redundancy');
    expect(achievedOf(ringOffice(false), gameEnv)).not.toContain('redundancy');
  });

  it('redundancy: 輪のないスイッチ2台（1本でつながり、それぞれに PC）は付かない', () => {
    const two = officeOf(
      [n('sw_a', 'l2_switch_8p', [], 0), n('sw_b', 'l2_switch_8p', [], 1), pc('pc_a', '192.168.1.11', 2), pc('pc_b', '192.168.1.12', 3)],
      [l('1', 'pc_a', 0, 'sw_a', 0), l('2', 'pc_b', 0, 'sw_b', 0), l('3', 'sw_a', 1, 'sw_b', 1)],
    );
    expect(achievedOf(two, gameEnv)).not.toContain('redundancy');
  });

  it('redundancy: 輪がなく、PC のつながらない行き止まりのスイッチがあっても付かない', () => {
    const spur = officeOf(
      [n('sw_a', 'l2_switch_8p', [], 0), n('sw_b', 'l2_switch_8p', [], 1), pc('pc_a', '192.168.1.11', 2), pc('pc_b', '192.168.1.12', 3)],
      [l('1', 'pc_a', 0, 'sw_a', 0), l('2', 'pc_b', 0, 'sw_a', 1), l('3', 'sw_a', 2, 'sw_b', 0)],
    );
    expect(achievedOf(spur, gameEnv)).not.toContain('redundancy');
  });

  it('redundancy: 輪があっても、輪の外の1本が切れると届かなくなる構成は付かない', () => {
    const ringWithSpur = officeOf(
      [...ringOffice(true).nodes, n('sw_c', 'l2_switch_8p', [], 5), pc('pc_c', '192.168.1.13', 6)],
      [...ringOffice(true).links, l('6', 'core', 2, 'sw_c', 0), l('7', 'pc_c', 0, 'sw_c', 1)],
    );
    expect(achievedOf(ringWithSpur, gameEnv)).not.toContain('redundancy');
  });

  it('機器のない自社オフィスは、実績がない', () => {
    expect(achievedOf(officeOf([], []), gameEnv)).toEqual([]);
  });
});

describe('月末の実績の更新', () => {
  it('新しく付いたものと、外れたものを分ける', () => {
    expect(settleAchievements(['dmz', 'redundancy'], ['redundancy', 'vlan_isolation'])).toEqual({ list: ['redundancy', 'vlan_isolation'], gained: ['vlan_isolation'], lost: ['dmz'] });
  });
});

describe('提案の依頼の論点', () => {
  const goals: Goal[] = [{ type: 'isolated', from: ['a'], to: ['b'] }];
  it('依頼の達成条件が学ぶ論点に実績があれば、その論点を返す', () => {
    expect(proposalTopicOf(goals, ['vlan_isolation'])).toBe('vlan_isolation');
  });
  it('実績のない論点の依頼は対象にならない', () => {
    expect(proposalTopicOf(goals, ['dmz'])).toBeNull();
  });
});
