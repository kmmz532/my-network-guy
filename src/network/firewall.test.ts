// ファイアウォールの規則（N38）。既定は拒否。規則に合う通信だけを通し、戻りは往路で許した通信として通す
import { describe, expect, it } from 'vitest';
import { http, ping } from './engine';
import { evaluateGoal } from './goals';
import type { EngineData, NetLink, NetNode, Network } from './types';

const data: EngineData = {
  categoryOf: (device) => ({ pc: 'pc', server: 'server', firewall: 'firewall' })[device] ?? 'unknown',
  maxLengthOf: () => 30,
};

const host = (uid: string, device: string, ip: string, gateway: string, services: NetNode['services'] = []): NetNode => ({
  uid,
  device,
  x: 0,
  y: 0,
  locked: false,
  configLocked: false,
  interfaces: [{ port: 0, ip, prefix: 24 }],
  gateway,
  routes: [],
  services,
});

const firewall = (rules?: NetNode['rules']): NetNode => ({
  uid: 'f',
  device: 'firewall',
  x: 0,
  y: 0,
  locked: false,
  configLocked: false,
  interfaces: [
    { port: 0, ip: '192.168.1.1', prefix: 24 },
    { port: 1, ip: '203.0.113.1', prefix: 24 },
  ],
  gateway: null,
  routes: [],
  services: [],
  rules,
});

const link = (uid: string, a: string, aPort: number, b: string, bPort: number): NetLink => ({ paid: 0,
  uid,
  cable: 'utp_cat5e',
  a: { node: a, port: aPort },
  b: { node: b, port: bPort },
  path: [
    [0, 0],
    [5, 0],
  ],
});

const network = (rules?: NetNode['rules']): Network => ({
  nodes: [
    host('a', 'pc', '192.168.1.10', '192.168.1.1'),
    firewall(rules),
    host('web', 'server', '203.0.113.10', '203.0.113.1', [{ protocol: 'http', port: 80 }]),
  ],
  links: [link('l1', 'a', 0, 'f', 0), link('l2', 'f', 1, 'web', 0)],
});

const allowWeb = { src: '192.168.1.0/24', dst: '203.0.113.0/24', service: 'http' as const, port: 80 };

describe('ファイアウォールの規則', () => {
  it('規則がなければ、通り道のファイアウォールで止まる（既定は拒否）', () => {
    const r = http(network(), data, 'a', 'web', 80);
    expect(r.failure).toMatchObject({ reason: 'firewall.denied', node: 'f' });
  });

  it('規則に合う http は通り、戻りも通る', () => {
    expect(http(network([allowWeb]), data, 'a', 'web', 80).ok).toBe(true);
  });

  it('規則が合わないポートは通らない', () => {
    expect(http(network([allowWeb]), data, 'a', 'web', 8080).failure?.reason).toBe('firewall.denied');
  });

  it('ping は規則に service: ping か any がないと通らない', () => {
    expect(ping(network([allowWeb]), data, 'a', 'web').failure?.reason).toBe('firewall.denied');
    expect(ping(network([{ src: 'any', dst: 'any', service: 'any' }]), data, 'a', 'web').ok).toBe(true);
  });

  it('送信元が規則のネットワークに入らなければ通らない', () => {
    const other = { ...allowWeb, src: '10.0.0.0/8' };
    expect(http(network([other]), data, 'a', 'web', 80).failure?.reason).toBe('firewall.denied');
  });

  it('blocked は、規則で止められているときだけ合格する', () => {
    const goal = { type: 'blocked' as const, from: 'web', to: 'a' };
    expect(evaluateGoal(goal, network([allowWeb]), data)[0].ok).toBe(true);
    expect(evaluateGoal(goal, network([{ src: 'any', dst: 'any', service: 'any' }]), data)[0].ok).toBe(false);
  });
});
