// 提案の依頼: 月末に、実績のある論点を学ぶ定型案件が届く（営業の社員がいなければ月1件まで、いれば月2件まで）。報酬は倍率が掛かる
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { balance, contracts, contractTemplates } from 'virtual:game-data';
import type { GameMap, Staff } from '../data/schema';
import type { Iface, NetLink, NetNode, PortConfig } from '../network/types';
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
    const pcs = offer.contract.placed.length;
    expect(offer.contract.reward.money).toBe(Math.round((template.reward.base + template.reward.perPc * pcs) * balance.proposal.rewardMul));
  });

  it('実績がなければ、提案の依頼は届かない', () => {
    useGameStore.setState({ staff: [], office: { ...emptyOffice({ w: 10, h: 8 }) } });
    expect(proposalsAfter({})).toHaveLength(0);
  });
});
