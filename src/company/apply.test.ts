// 操作の適用の試験: config の操作が、netEdit の関数を直接呼んだ結果と同じ core を返すこと
import { describe, expect, it } from 'vitest';
import balanceJson from '../../resources/data/balance.json';
import furnitureJson from '../../resources/data/furniture.json';
import officeJson from '../../resources/data/maps/office_small.json';
import type { Balance, Furniture, GameMap } from '../data/schema';
import { EMPTY_FAMILIARITY } from '../sim/familiar';
import { setInterface } from '../sim/netEdit';
import { placeInOffice } from '../sim/placement';
import { noEffects, type Core, type Env } from '../sim/project';
import { initialStaff } from '../sim/staff';
import { applyOperation, type OpContext } from './apply';
import { getComponent } from '../network/components';

const balance = balanceJson as unknown as Balance;
const map = officeJson as unknown as GameMap;
const env: Env = {
  balance,
  furniture: Object.fromEntries(furnitureJson.furniture.map((f) => [f.id, f as unknown as Furniture])),
  engine: { wallAt: () => false, interferers: [] },
};

// 自社オフィスに机だけを置いた構成（案件なし）
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
  rewardMul: 1,
  offers: [],
  active: [],
  focus: null,
  office: {
    bought: ['wood' as const], plans: {}, size: { w: 5, h: 5 }, innerWalls: [], doors: [], annexes: [], nodes: [], links: [], seq: 0,
    furniture: [{ uid: 'f0', id: 'desk', x: 3, y: 3 }],
    furnitureSeq: 1,
  },
  effects: noEffects(),
  staff: initialStaff(balance, 1).staff,
  staffSeq: 2,
  candidates: [],
  guidesDone: [],
  guidesHidden: [],
  termsShown: [],
});

const officeCtx: OpContext = { env, target: 'office', map: null, hq: map, mode: 'career' };

describe('applyOperation', () => {
  it('config の操作は、setInterface を直接呼んだ結果と同じ core を返す', () => {
    const placed = placeInOffice(start(), 'pc_basic', 3, 3, map, env, false, true);
    if (!placed.ok) throw new Error(`配置に失敗: ${placed.reason}`);
    const core = placed.core;
    const uid = core.office.nodes[0].uid;
    const ctx = officeCtx;

    const direct = setInterface(core, uid, 0, '192.168.0.10', 24, env, 'office');
    const viaOp = applyOperation(core, { kind: 'config', uid, change: { kind: 'iface', port: 0, ip: '192.168.0.10', prefix: 24 } }, ctx);

    expect(direct.ok).toBe(true);
    expect(viaOp).toEqual(direct);
  });
});

describe('負荷分散の設定の操作', () => {
  // ロードバランサーを置き、口に 10.0.0.100 を持たせた構成（仮想の IPアドレスは口のアドレスでなければならない）
  const withBalancer = (): { core: Core; uid: string } => {
    const placed = placeInOffice(start(), 'load_balancer', 1, 1, map, env, false, true);
    if (!placed.ok) throw new Error(`配置に失敗: ${placed.reason}`);
    const uid = placed.core.office.nodes[0].uid;
    const iface = { id: 'g0/0', kind: 'port' as const, port: 0, ip: '10.0.0.100', prefix: 24 };
    const nodes = placed.core.office.nodes.map((n) => (n.uid === uid ? { ...n, interfaces: [iface] } : n));
    return { core: { ...placed.core, office: { ...placed.core.office, nodes } }, uid };
  };
  const vs = { vip: '10.0.0.100', port: 80, members: [{ ip: '10.0.1.11', port: 80 }], method: 'round_robin' as const, healthCheck: 'http' as const, snat: true };
  const ctx = officeCtx;

  it('適用すると振り分けの一覧になり、前の一覧に戻す操作で元に戻る', () => {
    const { core, uid } = withBalancer();
    const before = getComponent(core.office.nodes[0], 'loadBalancer');
    const applied = applyOperation(core, { kind: 'config', uid, change: { kind: 'loadBalancer', servers: [vs] } }, ctx);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(getComponent(applied.core.office.nodes[0], 'loadBalancer')).toEqual([vs]);

    const restored = applyOperation(applied.core, { kind: 'config', uid, change: { kind: 'loadBalancer', servers: before ?? [] } }, ctx);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(getComponent(restored.core.office.nodes[0], 'loadBalancer')).toEqual([]);
  });
});
