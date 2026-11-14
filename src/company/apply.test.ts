// 操作の適用の試験: config の操作が、netEdit の関数を直接呼んだ結果と同じ core を返すこと
import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import furnitureJson from '../assets/data/furniture.json';
import officeJson from '../assets/data/maps/office_small.json';
import type { Balance, Furniture, GameMap } from '../data/schema';
import { EMPTY_FAMILIARITY } from '../sim/familiar';
import { setInterface } from '../sim/netEdit';
import { placeInOffice } from '../sim/placement';
import { noEffects, type Core, type Env } from '../sim/project';
import { initialStaff } from '../sim/staff';
import { applyOperation, type OpContext } from './apply';

const balance = balanceJson as unknown as Balance;
const map = officeJson as unknown as GameMap;
const env: Env = {
  balance,
  furniture: Object.fromEntries(furnitureJson.furniture.map((f) => [f.id, f as unknown as Furniture])),
  engine: { wallAt: () => false },
};

// 自社オフィスに机だけを置いた構成（案件なし）
const start = (): Core => ({
  clock: { minute: 0, money: 1_000_000, paidMonths: 0, bankrupt: false, ledger: [] },
  companyExp: 0,
  reputation: 0,
  owned: {},
  completed: [],
  deliveries: 0,
  familiarity: EMPTY_FAMILIARITY,
  purchaseDiscount: 0,
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
  termsShown: [],
});

describe('applyOperation', () => {
  it('config の操作は、setInterface を直接呼んだ結果と同じ core を返す', () => {
    const placed = placeInOffice(start(), 'pc_basic', 3, 3, map, env, false, true);
    if (!placed.ok) throw new Error(`配置に失敗: ${placed.reason}`);
    const core = placed.core;
    const uid = core.office.nodes[0].uid;
    const ctx: OpContext = { env, target: 'office', map: null, hq: map, mode: 'career' };

    const direct = setInterface(core, uid, 0, '192.168.0.10', 24, env, 'office');
    const viaOp = applyOperation(core, { kind: 'config', uid, change: { kind: 'iface', port: 0, ip: '192.168.0.10', prefix: 24 } }, ctx);

    expect(direct.ok).toBe(true);
    expect(viaOp).toEqual(direct);
  });
});
