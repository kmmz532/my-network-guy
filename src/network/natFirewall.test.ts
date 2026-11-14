// ファイアウォールの規則は、NAPT で送信元が変わる前の社内のアドレスで判定する（外の口のアドレスを規則に書かせない）
import { describe, expect, it } from 'vitest';
import { ping } from './engine';
import { analyze } from './engine/analyze';
import { withInternet } from './external';
import { gameEnv } from '../sim/env';
import type { Iface, NetLink, NetNode, Network } from './types';

const f = (port: number, ip: string, nat?: 'inside' | 'outside'): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24, ...(nat ? { nat } : {}) });
const n = (uid: string, device: string, interfaces: Iface[], x: number, extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device, x, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports: [], macSerial: x + 1, ...extra }) as NetNode;
const l = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });

const build = (rules: NonNullable<NetNode['rules']>): Network => ({
  nodes: [
    n('pc', 'pc_basic', [{ ...f(0, '192.168.1.10'), id: 'eth0' }], 0, { gateway: '192.168.1.1' }),
    n('fw', 'firewall', [f(0, '192.168.1.1', 'inside'), f(1, '198.51.100.2', 'outside')], 1, { napt: true, gateway: '198.51.100.1', rules }),
    n('line', 'uplink', [], 2, { isp: { name: 'ISP-A', network: '198.51.100.0', prefix: 24, ispIp: '198.51.100.1' } }),
  ],
  links: [l('a', 'pc', 0, 'fw', 0), l('b', 'fw', 1, 'line', 0)],
  plans: {},
});

const pingInternet = (rules: NonNullable<NetNode['rules']>) => {
  const withNet = withInternet(build(rules), gameEnv.engine);
  if (!withNet) throw new Error('回線がつながっていない');
  return ping(analyze(withNet, gameEnv.engine), 'pc', withNet.internetUid);
};

describe('NAPT とファイアウォールの規則', () => {
  it('変換の前の社内のアドレスを許す規則で、外へ出られる', () => {
    expect(pingInternet([{ src: '192.168.1.0/24', dst: 'any', service: 'any' }]).ok).toBe(true);
  });
  it('変換の後のアドレス（外の口）だけを許す規則では、止まる', () => {
    expect(pingInternet([{ src: '198.51.100.2/32', dst: 'any', service: 'any' }]).failure?.reason).toBe('firewall.denied');
  });
});
