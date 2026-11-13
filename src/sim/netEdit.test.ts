// 核の状態からネットワークの計算の結果を求める（analyzeCore）の確認。機器を置いた後も、その機器が計算の結果に入ること
import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import furnitureJson from '../assets/data/furniture.json';
import officeSmall from '../assets/data/maps/office_small.json';
import type { Balance, Furniture, GameMap } from '../data/schema';
import { initialOffice } from './furniture';
import { placeInOffice } from './placement';
import { analyzeCore } from './netEdit';
import type { Core, Env } from './project';

const balance = balanceJson as unknown as Balance;
const map = officeSmall as unknown as GameMap;
const env: Env = {
  balance,
  furniture: Object.fromEntries(furnitureJson.furniture.map((f) => [f.id, f as unknown as Furniture])),
  engine: { wallAt: () => false },
};

describe('analyzeCore', () => {
  it('機器を1台置いた後、自社オフィスの計算の結果にその機器がある', () => {
    const core: Core = {
      office: initialOffice(balance),
      active: [],
      focus: null,
      owned: { pc_basic: 1 },
    } as unknown as Core;
    const r = placeInOffice(core, 'pc_basic', 1, 1, map, env, true, true);
    if (!r.ok) throw new Error(`置けない: ${r.reason}`);
    const placed = r.core;
    const uid = placed.office.nodes[placed.office.nodes.length - 1].uid;
    const result = analyzeCore(placed, env, { hq: map });
    expect(result.office.net.nodes.some((n) => n.uid === uid)).toBe(true);
    expect(result.focus).toBeNull();
  });
});
