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
import { analyzeCore, removeHost, setBgp, setFirewallRules, setHost, setNameServer, setNat, setWireless } from './netEdit';
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

  it('帯に合わないチャネルを拒否する（2.4GHz は 1〜13、5GHz は 36 などの決まった番号）', () => {
    const at = (band: '2.4' | '5') => coreOf({ ...node('ap', 'access_point'), components: { wireless: { band } } } as NetNode);
    expect(setWireless(at('2.4'), 'ap', 'channel', 36, 'office').ok).toBe(false);
    expect(setWireless(at('2.4'), 'ap', 'channel', 14, 'office').ok).toBe(false);
    expect(setWireless(at('2.4'), 'ap', 'channel', 11, 'office').ok).toBe(true);
    expect(setWireless(at('5'), 'ap', 'channel', 1, 'office').ok).toBe(false);
    expect(setWireless(at('5'), 'ap', 'channel', 50, 'office').ok).toBe(false);
    expect(setWireless(at('5'), 'ap', 'channel', 100, 'office').ok).toBe(true);
  });

  it('機器が選べない帯を拒否する。帯を変えて今のチャネルが合わなければ、チャネルの設定を外す', () => {
    const core = coreOf({ ...node('ap', 'access_point'), components: { wireless: { band: '2.4', channel: 6 } } } as NetNode);
    expect(setWireless(core, 'ap', 'band', '6', 'office').ok).toBe(false);
    const r = setWireless(core, 'ap', 'band', '5', 'office');
    if (!r.ok) throw new Error(`設定できない: ${r.reason}`);
    expect(getComponent(r.core.office.nodes[0], 'wireless')).toEqual({ band: '5' });
  });
});

describe('setNat', () => {
  const node = (uid: string, device: string): NetNode =>
    ({ uid, device, x: 0, y: 0, locked: false, configLocked: false, interfaces: [], gateway: null, routes: [], services: [], ports: [] }) as NetNode;
  const coreOf = (...nodes: NetNode[]): Core =>
    ({ office: { ...initialOffice(balance), nodes }, active: [], focus: null, owned: {} }) as unknown as Core;

  it('NAT の能力のない機器では、NAPT の設定を拒否し、機器は変わらない', () => {
    const core = coreOf(node('sw', 'l2_switch_8p'));
    const r = setNat(core, 'sw', { op: 'napt', on: true }, 'office');
    expect(r.ok).toBe(false);
    expect(core.office.nodes[0].components).toBeUndefined();
  });

  it('NAT の能力のある機器では、components.nat に設定が入り、機器の直下には入らない', () => {
    const core = coreOf(node('r', 'router_basic'));
    const r = setNat(core, 'r', { op: 'napt', on: true }, 'office');
    if (!r.ok) throw new Error(`設定できない: ${r.reason}`);
    const next = r.core.office.nodes[0];
    expect(getComponent(next, 'nat')).toEqual({ napt: true });
    expect('napt' in next).toBe(false);
  });
});

describe('setFirewallRules', () => {
  const node = (uid: string, device: string): NetNode =>
    ({ uid, device, x: 0, y: 0, locked: false, configLocked: false, interfaces: [], gateway: null, routes: [], services: [], ports: [] }) as NetNode;
  const coreOf = (...nodes: NetNode[]): Core =>
    ({ office: { ...initialOffice(balance), nodes }, active: [], focus: null, owned: {} }) as unknown as Core;
  const rules = [{ src: '192.168.1.0/24', dst: 'any', service: 'any' as const }];

  it('ファイアウォールの能力のない機器では、規則の設定を拒否し、機器は変わらない', () => {
    const core = coreOf(node('sw', 'l2_switch_8p'));
    const r = setFirewallRules(core, 'sw', rules, 'office');
    expect(r.ok).toBe(false);
    expect(core.office.nodes[0].components).toBeUndefined();
  });

  it('ファイアウォールの能力のある機器では、components.firewall に規則が入り、機器の直下には入らない', () => {
    const core = coreOf(node('fw', 'firewall'));
    const r = setFirewallRules(core, 'fw', rules, 'office');
    if (!r.ok) throw new Error(`設定できない: ${r.reason}`);
    const next = r.core.office.nodes[0];
    expect(getComponent(next, 'firewall')).toEqual(rules);
    expect('rules' in next).toBe(false);
  });
});

describe('名前の引き方（resolver）', () => {
  const node = (uid: string, device: string): NetNode =>
    ({ uid, device, x: 0, y: 0, locked: false, configLocked: false, interfaces: [], gateway: null, routes: [], services: [], ports: [] }) as NetNode;
  const coreOf = (...nodes: NetNode[]): Core =>
    ({ office: { ...initialOffice(balance), nodes }, active: [], focus: null, owned: {} }) as unknown as Core;

  it('対応表とネームサーバーは、components.resolver に入り、機器の直下には入らない', () => {
    let core = coreOf(node('pc', 'pc_basic'));
    const step = (r: ReturnType<typeof setHost>) => {
      if (!r.ok) throw new Error(`設定できない: ${r.reason}`);
      return r.core;
    };
    core = step(setHost(core, 'pc', 'files', '192.168.1.20', 'office'));
    core = step(setNameServer(core, 'pc', '192.168.1.53', 'office'));
    const next = core.office.nodes[0];
    expect(getComponent(next, 'resolver')).toEqual({ hosts: [{ name: 'files', ip: '192.168.1.20' }], nameServer: '192.168.1.53' });
    expect('hosts' in next).toBe(false);
    expect('nameServer' in next).toBe(false);
    core = step(removeHost(core, 'pc', 'files', 'office'));
    expect(getComponent(core.office.nodes[0], 'resolver')?.hosts).toEqual([]);
  });
});
