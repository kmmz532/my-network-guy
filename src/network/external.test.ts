// 外部（インターネット）の判定（N71・N72）
import { describe, expect, it } from 'vitest';
import { outsideCheck, rentalOf, withInternet } from './external';
import type { EngineData, NetLink, NetNode, Network } from './types';

const data: EngineData = {
  categoryOf: (device) => ({ pc: 'pc', rt: 'router', l2: 'l2_switch' })[device] ?? 'unknown',
  maxLengthOf: () => 30,
};

const node = (uid: string, device: string, extra: Partial<NetNode> = {}): NetNode => ({
  uid,
  device,
  x: 0,
  y: 0,
  locked: false,
  configLocked: false,
  interfaces: [],
  gateway: null,
  routes: [],
  services: [],
  ...extra,
});
const link = (uid: string, a: string, ap: number, b: string, bp: number): NetLink => ({
  uid,
  cable: 'utp_cat5e',
  a: { node: a, port: ap },
  b: { node: b, port: bp },
  path: [
    [0, 0],
    [5, 0],
  ],
});

// ルーター r: WAN（ポート0）198.51.100.2、LAN（ポート1）192.168.1.1。PC a は LAN につながる
const office = (): Network => ({
  nodes: [
    node('r', 'rt', {
      interfaces: [
        { port: 0, ip: '198.51.100.2', prefix: 24 },
        { port: 1, ip: '192.168.1.1', prefix: 24 },
      ],
      routes: [{ dest: '0.0.0.0', prefix: 0, nextHop: '198.51.100.1' }],
    }),
    node('a', 'pc', { interfaces: [{ port: 0, ip: '192.168.1.10', prefix: 24 }], gateway: '192.168.1.1' }),
  ],
  links: [link('l1', 'a', 0, 'r', 1)],
});

describe('外部（インターネット）の判定（N71）', () => {
  it('WAN の口が空いたルーターがなければ、外部につながらない', () => {
    const net: Network = { nodes: [node('a', 'pc', { interfaces: [{ port: 0, ip: '192.168.1.10', prefix: 24 }] })], links: [] };
    expect(withInternet(net, data)).toBeNull();
    expect(outsideCheck(net, data).attached).toBe(false);
  });

  it('WAN の口が使われていれば、外部につながらない（配線は変えない）', () => {
    const net = office();
    const busy = { ...net, links: [...net.links, link('w', 'r', 0, 'a', 0)] };
    expect(withInternet(busy, data)).toBeNull();
  });

  it('WAN の口が空いていれば、社内の PC が外部へ届く', () => {
    const r = outsideCheck(office(), data);
    expect(r.attached).toBe(true);
    expect(r.pcsReachOutside).toBe(true);
  });

  it('外部から社内の PC へ届いてしまうと、漏れとして公開のサーバーは数えない', () => {
    const r = outsideCheck(office(), data);
    expect(r.leaks).toBe(true);
    expect(r.exposedServers).toEqual([]);
  });
});

describe('サーバーの貸し出しの収入（N72）', () => {
  it('漏れがあれば、収入はなく、公開のサーバーがあると評判が下がる', () => {
    const r = rentalOf(office(), data, 30000);
    expect(r.income).toBe(0);
    // この試験の社内には公開のサーバーがないため、評判は下がらない
    expect(r.penalty).toBe(false);
  });

  it('外部につながらなければ、収入はない', () => {
    const net: Network = { nodes: [node('a', 'pc', { interfaces: [{ port: 0, ip: '192.168.1.10', prefix: 24 }] })], links: [] };
    expect(rentalOf(net, data, 30000)).toEqual({ income: 0, penalty: false });
  });
});
