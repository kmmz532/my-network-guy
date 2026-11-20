// 能力を要する編集が、能力のない機器では、表の理由で拒否され、機器が変わらないことの確認
import { describe, expect, it } from 'vitest';
import balanceJson from '../../resources/data/balance.json';
import type { Balance } from '../data/schema';
import type { NetNode } from '../network/types';
import { CAPABILITY_REFUSALS, type GatedCapability } from './capabilityGate';
import { initialOffice } from './furniture';
import { REQUIRES } from '../network/components';
import { setBgp, setChannel, setDhcp, setFirewallRules, setIsp, setLoadBalancer, setNat, setOspf, setPortMode, setRouting, setStp, setSvi, setVpn, setVrrp, setWireless } from './netEdit';
import type { Core, Env, Outcome } from './project';

const balance = balanceJson as unknown as Balance;
const env = { balance, furniture: {}, engine: { wallAt: () => false, interferers: [] } } as unknown as Env;

// 何の能力も持たない機器（PC）と、スイッチ口だけを持つ機器（L2 スイッチ）
const node = (device: string): NetNode =>
  ({ uid: 'n', device, x: 0, y: 0, locked: false, configLocked: false, interfaces: [], gateway: null, routes: [], services: [], ports: [] }) as NetNode;
const coreOf = (device: string): Core =>
  ({ office: { ...initialOffice(balance), nodes: [node(device)] }, active: [], focus: null, owned: {} }) as unknown as Core;

const ATTEMPTS: Record<GatedCapability, { device: string; run: (core: Core) => Outcome }> = {
  svi: { device: 'pc_basic', run: (c) => setSvi(c, 'n', 10, '10.0.0.1', 24, env, 'office') },
  switchport: { device: 'pc_basic', run: (c) => setPortMode(c, 'n', 0, { kind: 'access', vlan: 10 }, 'office') },
  routedPort: { device: 'l2_switch_4p', run: (c) => setPortMode(c, 'n', 0, { kind: 'routed' }, 'office') },
  stp: { device: 'pc_basic', run: (c) => setStp(c, 'n', { op: 'priority', value: 4096 }, 'office') },
  vrrp: { device: 'pc_basic', run: (c) => setVrrp(c, 'n', { op: 'remove', id: 'x', vrid: 1 }, 'office') },
  dhcpRelay: { device: 'pc_basic', run: (c) => setDhcp(c, 'n', { op: 'helper', port: 0, ip: null }, 'office') },
  services: { device: 'pc_basic', run: (c) => setDhcp(c, 'n', { op: 'noPool', network: '10.0.0.0' }, 'office') },
  lag: { device: 'pc_basic', run: (c) => setChannel(c, 'n', { port: 0, group: 1 }, 'office') },
  wireless: { device: 'pc_basic', run: (c) => setWireless(c, 'n', 'ssid', 'x', 'office') },
  nat: { device: 'pc_basic', run: (c) => setNat(c, 'n', { op: 'napt', on: true }, 'office') },
  bgp: { device: 'pc_basic', run: (c) => setBgp(c, 'n', { op: 'asn', asn: 65001 }, 'office') },
  firewall: { device: 'pc_basic', run: (c) => setFirewallRules(c, 'n', [], 'office') },
  ospf: { device: 'pc_basic', run: (c) => setOspf(c, 'n', { op: 'routerId', ip: '1.1.1.1' }, 'office') },
  wan: { device: 'pc_basic', run: (c) => setIsp(c, 'n', { name: 'ISP', network: '198.51.100.0', prefix: 24, ispIp: '198.51.100.1' }, 'office') },
  loadBalance: { device: 'pc_basic', run: (c) => setLoadBalancer(c, 'n', [], 'office') },
  vpn: { device: 'pc_basic', run: (c) => setVpn(c, 'n', [], 'office') },
};

describe('能力の表', () => {
  // コンポーネントを付ける条件の能力が拒否の表になければ、能力のない機器への編集が拒否でなく例外になる
  it('コンポーネントを持てる条件の能力は、すべて拒否の表にある', () => {
    const missing = Object.values(REQUIRES).filter((c) => !(c in CAPABILITY_REFUSALS));
    expect(missing).toEqual([]);
  });

  it('OSPF の番号の指定も、能力のない機器では拒否される', () => {
    const core = coreOf('pc_basic');
    expect(setRouting(core, 'n', { proto: 'ospf', on: true, process: 1 }, 'office')).toEqual({ ok: false, reason: CAPABILITY_REFUSALS.ospf });
  });

  it.each(Object.keys(CAPABILITY_REFUSALS) as GatedCapability[])('%s の能力のない機器では、編集が表の理由で拒否される', (capability) => {
    const { device, run } = ATTEMPTS[capability];
    const core = coreOf(device);
    const r = run(core);
    expect(r).toEqual({ ok: false, reason: CAPABILITY_REFUSALS[capability] });
    expect(core.office.nodes[0].components).toBeUndefined();
  });
});
