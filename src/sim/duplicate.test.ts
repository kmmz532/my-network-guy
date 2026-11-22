import { EMPTY_FAMILIARITY } from './familiar';
import { describe, expect, it } from 'vitest';
import balanceJson from '../../resources/data/balance.json';

import furnitureJson from '../../resources/data/furniture.json';

import officeJson from '../../resources/data/maps/office_small.json';
import type { Balance, Furniture, GameMap } from '../data/schema';
import { initialStaff } from './staff';
import { connect, type Core, type Env, type Outcome } from './project';
import { duplicateNode, placeInOffice } from './placement';
import { setGateway, setInterface } from './netEdit';
import { analyze } from '../network/engine/analyze';
import { ping } from '../network/engine';

const balance = balanceJson as unknown as Balance;
const map = officeJson as unknown as GameMap;

const env: Env = {
  balance,
  furniture: Object.fromEntries(furnitureJson.furniture.map((f) => [f.id, f as unknown as Furniture])),
  engine: { wallAt: () => false, interferers: [] },
};

const start = (): Core => ({
  clock: { minute: 0, money: 1_000_000, paidMonths: 0, bankrupt: false, ledger: [] },
  companyExp: 0,
  reputation: 0,
  owned: {},
  completed: [],
  deliveries: 0,
  firstGoals: [],
  familiarity: EMPTY_FAMILIARITY,
  purchaseDiscount: 0,
  offers: [],
  active: [],
  focus: null,
  // 社員2人は、机に座っている（施工力は1ずつ）
  office: { bought: ['wood' as const], plans: {},
    size: { w: 5, h: 5 }, innerWalls: [], doors: [], annexes: [],
    nodes: [],
    links: [],
    seq: 0,
    furniture: [
      { uid: 'f0', id: 'desk', x: 3, y: 3 },
      { uid: 'f1', id: 'desk', x: 6, y: 3 },
    ],
    furnitureSeq: 2,
  },
  effects: { buildSpeed: 0 },
  // 初めの社員は、初めの2つの机に座る（ゲームの開始と同じ）
  staff: initialStaff(balance, 1).staff.map((s, i) => ({ ...s, desk: i === 0 ? 'f0' : i === 1 ? 'f1' : null })),
  staffSeq: 2,
  candidates: [],
  guidesDone: [],
  guidesHidden: [],
  termsShown: [],
});

const ok = (r: Outcome) => {
  if (!r.ok) throw new Error(`失敗: ${r.reason}`);
  return r.core;
};
const sandboxCore = (): Core => ({ ...start(), owned: {} });
const pcsOf = (core: Core) => core.office.nodes.filter((n) => n.device === 'pc_basic');

describe('機器の複製', () => {
  it('機種と設定を隣の空いたマスに写し、配線は写さない。名前は重ならない', () => {
    let core = sandboxCore();
    core = ok(placeInOffice(core, 'pc_basic', 3, 3, map, env, true, true));
    core = ok(placeInOffice(core, 'l2_switch_8p', 2, 4, map, env, true, true));
    const sw = core.office.nodes.find((n) => n.device === 'l2_switch_8p')!;
    const pcUid = pcsOf(core)[0].uid;
    core = ok(setInterface(core, pcUid, 0, '192.168.1.10', 24, env, 'office'));
    core = ok(setGateway(core, pcUid, '192.168.1.1', 'office'));
    core = ok(connect(core, pcUid, sw.uid, 'utp_cat5e', env, 'office'));
    const pc = pcsOf(core)[0];

    const copied = ok(duplicateNode(core, pc.uid, env, 'office', map, true));
    const nodes = pcsOf(copied);
    expect(nodes).toHaveLength(2);
    const copy = nodes.find((n) => n.uid !== pc.uid)!;
    expect(copy.device).toBe(pc.device);
    expect(copy.interfaces).toEqual(pc.interfaces);
    expect(copy.gateway).toBe('192.168.1.1');
    expect(copy.hostname).not.toBe(pc.hostname);
    expect(Math.abs(copy.x - pc.x) + Math.abs(copy.y - pc.y)).toBeGreaterThan(0);
    expect(Math.abs(copy.x - pc.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(copy.y - pc.y)).toBeLessThanOrEqual(1);
    expect(copied.office.links).toHaveLength(1);
    expect(copied.office.links.some((l) => l.a.node === copy.uid || l.b.node === copy.uid)).toBe(false);
  });

  it('自動（DHCP）の口は、アドレスを 0.0.0.0 にして写す', () => {
    let core = sandboxCore();
    core = ok(placeInOffice(core, 'pc_basic', 3, 3, map, env, true, true));
    const [pc] = pcsOf(core);
    core = {
      ...core,
      office: { ...core.office, nodes: core.office.nodes.map((n) => (n.uid === pc.uid ? { ...n, interfaces: [{ ...n.interfaces[0], ip: '192.168.1.50', prefix: 24, dhcp: true }] } : n)) },
    };
    const copied = ok(duplicateNode(core, pc.uid, env, 'office', map, true));
    const copy = pcsOf(copied).find((n) => n.uid !== pc.uid)!;
    expect(copy.interfaces[0]).toMatchObject({ dhcp: true, ip: '0.0.0.0' });
    expect(pcsOf(copied).find((n) => n.uid === pc.uid)!.interfaces[0].ip).toBe('192.168.1.50');
  });

  it('OSPF の routerId と VRRP のグループは写さず、元の機器には残す', () => {
    let core = sandboxCore();
    core = ok(placeInOffice(core, 'pc_basic', 3, 3, map, env, true, true));
    const [pc] = pcsOf(core);
    core = {
      ...core,
      office: {
        ...core.office,
        nodes: core.office.nodes.map((n) =>
          n.uid === pc.uid
            ? { ...n, components: { ospf: { routerId: '10.0.0.1', defaultOriginate: true } }, interfaces: [{ ...n.interfaces[0], ip: '192.168.1.10', prefix: 24, vrrp: [{ vrid: 1, ip: '192.168.1.1', priority: 100, preempt: true }] }] }
            : n,
        ),
      },
    };
    const copied = ok(duplicateNode(core, pc.uid, env, 'office', map, true));
    const copy = pcsOf(copied).find((n) => n.uid !== pc.uid)!;
    expect(copy.components?.ospf?.routerId).toBeUndefined();
    expect(copy.components?.ospf?.defaultOriginate).toBe(true);
    expect(copy.interfaces[0].vrrp).toBeUndefined();
    expect(copy.interfaces[0].ip).toBe('192.168.1.10');
    const original = pcsOf(copied).find((n) => n.uid === pc.uid)!;
    expect(original.components?.ospf?.routerId).toBe('10.0.0.1');
    expect(original.interfaces[0].vrrp).toHaveLength(1);
  });

  it('経営モードでは在庫を1つ使い、在庫がなければ複製しない。サンドボックスは在庫を数えない', () => {
    let core: Core = { ...start(), owned: { l2_switch_8p: 2 } };
    core = ok(placeInOffice(core, 'l2_switch_8p', 2, 4, map, env));
    expect(core.owned.l2_switch_8p).toBe(1);
    const sw = core.office.nodes[0];
    const copied = ok(duplicateNode(core, sw.uid, env, 'office', map, false));
    expect(copied.owned.l2_switch_8p).toBe(0);
    expect(copied.office.nodes).toHaveLength(2);
    expect(duplicateNode(copied, sw.uid, env, 'office', map, false)).toEqual({ ok: false, reason: 'stock' });

    const free = ok(placeInOffice(sandboxCore(), 'l2_switch_8p', 2, 4, map, env, true, true));
    const again = ok(duplicateNode(free, free.office.nodes[0].uid, env, 'office', map, true));
    expect(again.owned).toEqual({});
    expect(again.office.nodes).toHaveLength(2);
  });

  it('固定のアドレスを写して同じスイッチにつなぐと、今の警告の仕組みで IP の重なりが出る', () => {
    let core = sandboxCore();
    core = ok(placeInOffice(core, 'pc_basic', 3, 3, map, env, true, true));
    core = ok(placeInOffice(core, 'l2_switch_8p', 2, 4, map, env, true, true));
    const [pc] = pcsOf(core);
    const sw = core.office.nodes.find((n) => n.device === 'l2_switch_8p')!;
    core = ok(setInterface(core, pc.uid, 0, '192.168.1.10', 24, env, 'office'));
    core = ok(connect(core, pc.uid, sw.uid, 'utp_cat5e', env, 'office'));
    core = ok(duplicateNode(core, pc.uid, env, 'office', map, true));
    const copy = pcsOf(core).find((n) => n.uid !== pc.uid)!;
    core = ok(connect(core, copy.uid, sw.uid, 'utp_cat5e', env, 'office'));
    core = ok(placeInOffice(core, 'pc_basic', 1, 1, map, env, true, true));
    const other = pcsOf(core).find((n) => n.uid !== pc.uid && n.uid !== copy.uid)!;
    core = ok(setInterface(core, other.uid, 0, '192.168.1.11', 24, env, 'office'));
    core = ok(connect(core, other.uid, sw.uid, 'utp_cat5e', env, 'office'));
    const view = analyze({ nodes: core.office.nodes, links: core.office.links, plans: core.office.plans }, env.engine);
    expect(ping(view, other.uid, pc.uid).failure?.reason).toBe('ip.duplicate');
  });
});
