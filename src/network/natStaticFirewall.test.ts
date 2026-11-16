// 静的 NAT で外から入る通信にも、ファイアウォールの規則を当てる。規則は変換の前のアドレス（外の機器の IP と社内のサーバーの IP）で判定する
import { describe, expect, it } from 'vitest';
import { http } from './engine';
import { analyze } from './engine/analyze';
import { gameEnv } from '../sim/env';
import type { Iface, NetLink, NetNode, Network } from './types';

const f = (port: number, ip: string, nat?: 'inside' | 'outside'): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24, ...(nat ? { nat } : {}) });
const n = (uid: string, device: string, interfaces: Iface[], x: number, extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device, x, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports: [], macSerial: x + 1, ...extra }) as NetNode;
const l = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });

const build = (rules: NonNullable<NonNullable<NetNode['components']>['firewall']>): Network => ({
  nodes: [
    n('ext', 'pc_basic', [f(0, '203.0.113.50')], 0, { gateway: '203.0.113.1' }),
    n('fw', 'firewall', [f(0, '203.0.113.1', 'outside'), f(1, '192.168.1.1', 'inside')], 1, {
      components: { nat: { napt: true, statics: [{ port: 80, insideIp: '192.168.1.10', insidePort: 80 }] }, firewall: rules },
    }),
    n('srv', 'server_basic', [f(0, '192.168.1.10')], 2, { gateway: '192.168.1.1', services: [{ protocol: 'http', port: 80 }] }),
  ],
  links: [l('l0', 'ext', 0, 'fw', 0), l('l1', 'fw', 1, 'srv', 0)],
  plans: {},
});

const reach = (rules: NonNullable<NonNullable<NetNode['components']>['firewall']>) => http(analyze(build(rules), gameEnv.engine), 'ext', 'fw', 80);

describe('静的 NAT とファイアウォールの規則', () => {
  it('規則がなければ、外から社内のサーバーへ届かない', () => {
    expect(reach([]).failure?.reason).toBe('firewall.denied');
  });
  it('外の機器の IP から社内のサーバーの IP への HTTP を許す規則で届く', () => {
    expect(reach([{ src: '203.0.113.50/32', dst: '192.168.1.10/32', service: 'http', port: 80 }]).ok).toBe(true);
  });
  it('公開のアドレス（外の口）を宛先に書いた規則では届かない', () => {
    expect(reach([{ src: '203.0.113.50/32', dst: '203.0.113.1/32', service: 'http', port: 80 }]).failure?.reason).toBe('firewall.denied');
  });
});
