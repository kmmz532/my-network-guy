import { ping } from './engine';
import { analyze } from './engine/analyze';
// ポートセキュリティ（N153）: 登録のない MAC の機器がつながると、スイッチの口で止まる
import { describe, expect, it } from 'vitest';
import { macOf } from './mac';
import type { EngineData, Iface, NetLink, NetNode, Network, PortConfig } from './types';

const data: EngineData = { wallAt: () => false };
const f = (port: number, ip: string): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24 });
const host = (uid: string, ip: string, serial: number, x: number): NetNode =>
  ({ uid, device: 'pc_basic', macSerial: serial, x, y: 0, locked: false, configLocked: false, interfaces: [f(0, ip)], gateway: null, routes: [], services: [], ports: [] }) as NetNode;
const build = (macs?: string[]): Network => {
  const ports: PortConfig[] = [{ port: 1, mode: 'access', vlan: 1, ...(macs === undefined ? {} : { macs }) }, { port: 2, mode: 'access', vlan: 1 }];
  const sw = { uid: 'sw', device: 'l2_switch_8p', x: 1, y: 0, locked: false, configLocked: false, interfaces: [], gateway: null, routes: [], services: [], ports } as unknown as NetNode;
  const links: NetLink[] = [
    { uid: 'l0', cable: 'utp_cat5e', a: { node: 'a', port: 0 }, b: { node: 'sw', port: 1 }, path: [[0, 0], [1, 0]], paid: 0 },
    { uid: 'l1', cable: 'utp_cat5e', a: { node: 'b', port: 0 }, b: { node: 'sw', port: 2 }, path: [[0, 0], [1, 0]], paid: 0 },
  ];
  return { nodes: [host('a', '192.168.1.10', 1, 0), sw, host('b', '192.168.1.20', 2, 2)], links, plans: {} };
};
const macA = macOf('pc', 1, 0);

describe('ポートセキュリティ（N153）', () => {
  it('登録のない口（macs がない）は制限しない', () => {
    expect(ping(analyze(build(), data), 'a', 'b').ok).toBe(true);
  });
  it('登録した MAC の機器なら通る', () => {
    expect(ping(analyze(build([macA]), data), 'a', 'b').ok).toBe(true);
  });
  it('登録のない MAC の機器は、スイッチの口で止まる（port.security）', () => {
    const r = ping(analyze(build(['02:99:99:99:99:99']), data), 'a', 'b');
    expect(r.ok).toBe(false);
    expect(r.failure?.reason).toBe('port.security');
  });
});
