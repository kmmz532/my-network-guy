// 提案の依頼: 月末に、実績のある論点を学ぶ定型案件が届く（営業の社員がいなければ月1件まで、いれば月2件まで）。報酬は倍率が掛かる
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { balance, contracts, contractTemplates } from 'virtual:game-data';
import type { GameMap, Staff } from '../data/schema';
import type { Iface, NetLink, NetNode, PortConfig } from '../network/types';
import { optimalCostOf, rewardOf } from '../contracts/budget';
import { emptyOffice } from '../sim/project';
import { achievementsSystem } from './tickSystems';
import { useGameStore, type GameState } from './useGameStore';

const mapsDir = join(import.meta.dirname, '../../resources/data/maps');
const maps = Object.fromEntries(readdirSync(mapsDir).map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(mapsDir, f), 'utf8')) as GameMap]));

const f = (port: number, ip: string): Iface => ({ id: `eth${port}`, kind: 'port', port, ip, prefix: 24 });
const n = (uid: string, device: string, interfaces: Iface[], x: number, extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device, x, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports: [], macSerial: x + 1, ...extra }) as NetNode;
const l = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });
// PC 2台を別の VLAN に分けたスイッチ（vlan_isolation の実績が付く）
const vlanNodes = [
  n('sw', 'l2_switch_8p', [], 0, { ports: [10, 20].map((vlan, port): PortConfig => ({ port, mode: 'access', vlan })) }),
  n('a', 'pc_basic', [f(0, '192.168.1.11')], 1),
  n('b', 'pc_basic', [f(0, '192.168.1.12')], 2),
];

const env = { now: 1, payPause: false, nightFast: false };
const proposalsAfter = (patch: Partial<GameState>): GameState['offers'] => ((achievementsSystem(useGameStore.getState(), patch, env).offers ?? []) as GameState['offers']).filter((o) => o.proposal === true);

const base = (): Partial<GameState> => ({
  office: { ...emptyOffice({ w: 10, h: 8 }), nodes: vlanNodes, links: [l('1', 'a', 0, 'sw', 0), l('2', 'b', 0, 'sw', 1)] },
  maps,
  companyExp: 10_000_000,
  completed: contracts.map((c) => c.id),
  offers: [],
  active: [],
  achievements: [],
  clearedAt: null,
  medals: [],
  records: { threeStars: 0, biggest: null },
});

// 公開の Web（dmz）: 回線の機器→ルーター（静的 NAT で外のポート80をサーバーへ）→ スイッチ2台。PC は別のスイッチで、ケーブルが切れると PC とサーバーが分かれる
const fn = (port: number, ip: string, nat?: 'inside' | 'outside'): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24, ...(nat ? { nat } : {}) });
const publicWebOffice = (): Partial<GameState> => ({
  office: {
    ...emptyOffice({ w: 10, h: 8 }),
    nodes: [
      n('uplink', 'uplink', [], 0),
      n('r', 'router_basic', [fn(0, '198.51.100.2', 'outside'), fn(1, '192.168.1.1', 'inside')], 1, {
        routes: [{ dest: '0.0.0.0', prefix: 0, nextHop: '198.51.100.1' }],
        components: { nat: { napt: true, statics: [{ port: 80, insideIp: '192.168.1.80', insidePort: 80 }] } },
      }),
      n('sw1', 'l2_switch_8p', [], 2),
      n('sw2', 'l2_switch_8p', [], 3),
      n('pc', 'pc_basic', [f(0, '192.168.1.11')], 4, { gateway: '192.168.1.1' }),
      n('srv', 'server_basic', [f(0, '192.168.1.80')], 5, { gateway: '192.168.1.1', services: [{ protocol: 'http', port: 80 }] }),
    ],
    links: [l('1', 'uplink', 0, 'r', 0), l('2', 'r', 1, 'sw2', 0), l('3', 'sw1', 0, 'sw2', 1), l('4', 'pc', 0, 'sw1', 1), l('5', 'srv', 0, 'sw2', 2)],
  },
});

// 冗長な社内LAN（redundancy）: 3台のスイッチを輪につなぎ、PC とサーバーをつなぐ
const ringOffice = (): Partial<GameState> => ({
  office: {
    ...emptyOffice({ w: 10, h: 8 }),
    nodes: [
      n('core', 'l2_switch_8p', [], 0),
      n('sw_a', 'l2_switch_8p', [], 1),
      n('sw_b', 'l2_switch_8p', [], 2),
      n('pc_a', 'pc_basic', [f(0, '192.168.1.11')], 3),
      n('pc_b', 'pc_basic', [f(0, '192.168.1.12')], 4),
      n('srv', 'server_basic', [f(0, '192.168.1.50')], 5),
    ],
    links: [l('1', 'core', 0, 'sw_a', 1), l('2', 'core', 1, 'sw_b', 1), l('3', 'sw_a', 0, 'sw_b', 0), l('4', 'pc_a', 0, 'sw_a', 2), l('5', 'pc_b', 0, 'sw_b', 2), l('6', 'srv', 0, 'core', 2)],
  },
});

beforeEach(() => {
  useGameStore.setState(base());
});

describe('提案の依頼の届く数', () => {
  it('営業の社員がいなければ、月に1件まで届く', () => {
    useGameStore.setState({ staff: [] });
    expect(proposalsAfter({})).toHaveLength(balance.proposal.perMonth);
  });

  it('営業の社員がいれば、月に2件まで届く', () => {
    const member = useGameStore.getState().staff[0] ?? ({} as Staff);
    useGameStore.setState({ staff: [{ ...member, job: 'sales', level: 5, shift: 'day', training: null }] });
    expect(proposalsAfter({})).toHaveLength(balance.proposal.perMonthWithSales);
  });

  it('実績のある論点を学ぶ依頼だけが届き、報酬に倍率が掛かる', () => {
    useGameStore.setState({ staff: [] });
    const [offer] = proposalsAfter({});
    const template = contractTemplates.find((t) => (t.textId ?? t.id) === offer.baseId);
    if (!template) throw new Error('提案の依頼のひな形がない');
    expect(template.goals.some((g) => g.type === 'isolated')).toBe(true);
    expect(offer.topic).toBe('vlan_isolation');
    const pcs = offer.contract.placed.filter((p) => p.device === 'pc_basic');
    const cost = optimalCostOf(template, maps[template.map], pcs, offer.contract.furniture ?? []);
    expect(offer.contract.reward.money).toBe(Math.round(rewardOf(template, cost, pcs.length) * balance.proposal.rewardMul));
  });

  it('公開のサーバーを静的 NAT で外へ出した会社（dmz）には、t_public_web の提案が届く', () => {
    useGameStore.setState({ staff: [], ...publicWebOffice() });
    const [offer] = proposalsAfter({});
    expect(offer.baseId).toBe('t_public_web');
    expect(offer.topic).toBe('dmz');
  });

  it('つながりに止まる配線がある（ケーブルが1本切れると届かない）会社（redundancy）には、t_redundant_core の提案が届く', () => {
    useGameStore.setState({ staff: [], ...ringOffice() });
    const [offer] = proposalsAfter({});
    expect(offer.baseId).toBe('t_redundant_core');
    expect(offer.topic).toBe('redundancy');
  });

  it('実績がなければ、提案の依頼は届かない', () => {
    useGameStore.setState({ staff: [], office: { ...emptyOffice({ w: 10, h: 8 }) } });
    expect(proposalsAfter({})).toHaveLength(0);
  });
});
