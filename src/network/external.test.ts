// 外部（インターネット）の判定（N71・N72）
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import { customersOf, outsideCheck, rentalOf, withInternet } from './external';
import type { EngineData, NetLink, NetNode, Network } from './types';

const data: EngineData = { wallAt: () => false };

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
  ports: [],
  ...extra,
});
const link = (uid: string, a: string, ap: number, b: string, bp: number): NetLink => ({ paid: 0,
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
    node('r', 'router_basic', {
      interfaces: [
        { id: "g0/0", kind: "port", port: 0, ip: '198.51.100.2', prefix: 24 },
        { id: "g0/1", kind: "port", port: 1, ip: '192.168.1.1', prefix: 24 },
      ],
      routes: [{ dest: '0.0.0.0', prefix: 0, nextHop: '198.51.100.1' }],
    }),
    node('a', 'pc_basic', { interfaces: [{ id: "g0/0", kind: "port", port: 0, ip: '192.168.1.10', prefix: 24 }], gateway: '192.168.1.1' }),
    // 回線終端（口0 がルーターの WAN 側）。インターネットは口1 につながる（N144）
    node('u', 'uplink', { ports: [] }),
  ],
  links: [link('l1', 'a', 0, 'r', 1), link('l0', 'r', 0, 'u', 0)],
});

describe('外部（インターネット）の判定（N71）', () => {
  it('回線終端がなければ、外部につながらない（今の外部の仕組みは回線が要る）', () => {
    const net: Network = { nodes: [node('a', 'pc_basic', { interfaces: [{ id: "g0/0", kind: "port", port: 0, ip: '192.168.1.10', prefix: 24 }] })], links: [] };
    expect(withInternet(net, data)).toBeNull();
    expect(outsideCheck(net, data).attached).toBe(false);
  });

  it('回線終端がルーターにつながっていなければ、外部につながらない', () => {
    const net = office();
    const unplugged = { ...net, links: net.links.filter((l) => l.uid !== 'l0') };
    expect(withInternet(unplugged, data)).toBeNull();
  });

  it('回線終端がつながっていれば、社内の PC が外部へ届く', () => {
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

describe('サーバーの貸し出しの収入', () => {
  const rental = { monthlyPerCustomer: 30000, levelsPerCustomer: 3 };

  it('漏れがあれば、収入はない', () => {
    const r = rentalOf(office(), data, rental, 1, 30);
    expect(r.monthly).toBe(0);
    expect(r.daily).toBe(0);
    expect(r.leaks).toBe(true);
    // この試験の社内には公開のサーバーがないため、評判は下がらない
    expect(r.penalty).toBe(false);
  });

  it('外部につながらなければ、収入はない', () => {
    const net: Network = { nodes: [node('a', 'pc_basic', { interfaces: [{ id: "g0/0", kind: "port", port: 0, ip: '192.168.1.10', prefix: 24 }] })], links: [] };
    expect(rentalOf(net, data, rental, 1, 30)).toEqual({ monthly: 0, daily: 0, penalty: false, leaks: false, exposed: 0 });
  });

  it('顧客の数は、レベルで増える（levelsPerCustomer のレベルごとに1件）', () => {
    expect(customersOf(1, 3)).toBe(1);
    expect(customersOf(3, 3)).toBe(1);
    expect(customersOf(4, 3)).toBe(2);
    expect(customersOf(10, 3)).toBe(4);
  });
});

describe('2社の ISP（回線終端ごと）', () => {
  const two = (): Network => ({
    nodes: [
      node('r', 'router_basic', {
        interfaces: [
          { id: 'g0/0', kind: 'port', port: 0, ip: '198.51.100.2', prefix: 24 },
          { id: 'g0/1', kind: 'port', port: 1, ip: '192.168.1.1', prefix: 24 },
          { id: 'g0/2', kind: 'port', port: 2, ip: '203.0.113.2', prefix: 24 },
        ],
        bgp: { asn: 64512, neighbors: [{ ip: '198.51.100.1', remoteAs: 65001 }, { ip: '203.0.113.1', remoteAs: 65002 }], networks: [] },
      }),
      node('a', 'pc_basic', { interfaces: [{ id: 'g0/0', kind: 'port', port: 0, ip: '192.168.1.10', prefix: 24 }], gateway: '192.168.1.1' }),
      node('u1', 'uplink', { isp: { name: 'ISP-A', network: '198.51.100.0', prefix: 24, ispIp: '198.51.100.1', asn: 65001 } }),
      node('u2', 'uplink', { isp: { name: 'ISP-B', network: '203.0.113.0', prefix: 24, ispIp: '203.0.113.1', asn: 65002 } }),
    ],
    links: [link('l1', 'a', 0, 'r', 1), link('l0', 'r', 0, 'u1', 0), link('l2', 'r', 2, 'u2', 0)],
  });
  it('回線終端ごとに ISP を加え、それぞれの AS 番号と BGP の隣接を持つ', () => {
    const w = withInternet(two(), data);
    expect(w?.internetUids).toEqual(['__internet', '__internet_u2']);
    expect(w?.nodes.find((n) => n.uid === '__internet_u2')?.bgp?.asn).toBe(65002);
  });
  it('どちらの ISP からも外部の経路を BGP で覚え、PC が外部へ届く', async () => {
    const { bgpTableOf } = await import('./query/bgpTable');
    const { analyze } = await import('./engine/analyze');
    const w = withInternet(two(), data)!;
    const best = bgpTableOf(analyze(w, data), 'r')!.candidates.filter((c) => c.dest === '192.0.2.0');
    expect(best.map((c) => c.from).sort()).toEqual(['198.51.100.1', '203.0.113.1']);
    expect(best.find((c) => c.best)?.from).toBe('198.51.100.1');
    expect(outsideCheck(two(), data).pcsReachOutside).toBe(true);
  });
  it('survive_uplink_failure: 回線が2本あれば合格、1本だけなら不合格', async () => {
    const { evaluateGoal } = await import('./goals');
    expect(evaluateGoal({ type: 'survive_uplink_failure' }, analyze(two(), data))[0].ok).toBe(true);
    expect(evaluateGoal({ type: 'survive_uplink_failure' }, analyze(office(), data))[0].ok).toBe(false);
  });
});
