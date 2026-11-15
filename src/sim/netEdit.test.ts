// 核の状態からネットワークの計算の結果を求める（analyzeCore）の確認。機器を置いた後も、その機器が計算の結果に入ること
import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import furnitureJson from '../assets/data/furniture.json';
import officeSmall from '../assets/data/maps/office_small.json';
import type { Balance, Furniture, GameMap } from '../data/schema';
import { initialOffice } from './furniture';
import { placeInOffice } from './placement';
import { getComponent } from '../network/components';
import type { NetNode } from '../network/types';
import { analyzeCore, setBgp, setWireless } from './netEdit';
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

describe('setBgp', () => {
  const node = (uid: string, device: string): NetNode =>
    ({ uid, device, x: 0, y: 0, locked: false, configLocked: false, interfaces: [], gateway: null, routes: [], services: [], ports: [] }) as NetNode;
  const coreOf = (...nodes: NetNode[]): Core =>
    ({ office: { ...initialOffice(balance), nodes }, active: [], focus: null, owned: {} }) as unknown as Core;

  it('BGP の能力のない機器では、router bgp の設定を拒否し、機器は変わらない', () => {
    const core = coreOf(node('pc', 'pc_basic'));
    const r = setBgp(core, 'pc', { op: 'asn', asn: 65001 }, 'office');
    expect(r.ok).toBe(false);
    expect(core.office.nodes[0].components).toBeUndefined();
  });

  it('BGP の能力のある機器では、components.bgp に設定が入り、機器の直下には入らない', () => {
    const core = coreOf(node('r', 'edge_router'));
    const r = setBgp(core, 'r', { op: 'asn', asn: 65001 }, 'office');
    if (!r.ok) throw new Error(`設定できない: ${r.reason}`);
    const next = r.core.office.nodes[0];
    expect(getComponent(next, 'bgp')).toEqual({ asn: 65001, neighbors: [], networks: [] });
    expect('bgp' in next).toBe(false);
  });
});

describe('setWireless', () => {
  const node = (uid: string, device: string): NetNode =>
    ({ uid, device, x: 0, y: 0, locked: false, configLocked: false, interfaces: [], gateway: null, routes: [], services: [], ports: [] }) as NetNode;
  const coreOf = (...nodes: NetNode[]): Core =>
    ({ office: { ...initialOffice(balance), nodes }, active: [], focus: null, owned: {} }) as unknown as Core;

  it('無線の能力のない機器では、wireless の設定を拒否し、機器は変わらない', () => {
    const core = coreOf(node('pc', 'pc_basic'));
    const r = setWireless(core, 'pc', 'ssid', 'lab', 'office');
    expect(r.ok).toBe(false);
    expect(core.office.nodes[0].components).toBeUndefined();
  });

  it('無線の能力のある機器では、components.wireless に設定が入り、機器の直下には入らない', () => {
    const core = coreOf(node('ap', 'access_point'));
    const r = setWireless(core, 'ap', 'ssid', 'lab', 'office');
    if (!r.ok) throw new Error(`設定できない: ${r.reason}`);
    const next = r.core.office.nodes[0];
    expect(getComponent(next, 'wireless')).toEqual({ ssid: 'lab' });
    expect('wireless' in next).toBe(false);
  });
});
