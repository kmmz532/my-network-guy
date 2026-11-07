// 静的 NAT（ポートの転送・N145）: 外の口の HTTP を、社内のサーバーへ届ける
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import { http } from './netState';
import type { Iface, NetNode, Network } from './types';

const f = (port: number, ip: string, nat?: 'inside' | 'outside'): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24, ...(nat ? { nat } : {}) });
const n = (uid: string, device: string, interfaces: Iface[], gateway: string | null, extra: Partial<NetNode> = {}, x = 0): NetNode =>
  ({ uid, device, x, y: 0, locked: false, configLocked: false, interfaces, gateway, routes: [], services: [], ports: [], ...extra }) as NetNode;
const l = (uid: string, a: string, pa: number, b: string, pb: number) => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]] as [number, number][], paid: 0 });

// 外（198.51.100.1）— R（外 198.51.100.2・社内 192.168.1.1）— サーバー（192.168.1.20・HTTP 80）
const build = (statics: NonNullable<NetNode['statics']>): Network => ({
  nodes: [
    n('net', 'internet', [f(0, '198.51.100.1')], null, {}, 0),
    n('r', 'router_basic', [f(0, '198.51.100.2', 'outside'), f(1, '192.168.1.1', 'inside')], null, { routes: [{ dest: '192.168.1.20', prefix: 32, nextHop: '192.168.1.20' }], statics } as Partial<NetNode>, 1),
    n('srv', 'server_basic', [f(0, '192.168.1.20')], '192.168.1.1', { services: [{ protocol: 'http', port: 80 }] }, 2),
  ],
  links: [l('l0', 'net', 0, 'r', 0), l('l1', 'r', 1, 'srv', 0)],
  segments: {},
});

describe('静的 NAT（N145）', () => {
  it('外の口の HTTP を、転送の設定どおり社内のサーバーへ届ける（戻りも届く）', () => {
    const r = http(build([{ port: 80, insideIp: '192.168.1.20', insidePort: 80 }]), gameEnv.engine, 'net', 'r', 80);
    expect(r.ok).toBe(true);
  });

  it('転送の設定がなければ、外の口の HTTP は届かない（サービスは開いていない）', () => {
    const r = http(build([]), gameEnv.engine, 'net', 'r', 80);
    expect(r.ok).toBe(false);
  });
});
