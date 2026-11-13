import { describe, expect, it } from 'vitest';
import { hostCapacity, networkAddress, planFor } from './segments';
import { fillPlans } from './query/plans';
import { analyze } from './engine/analyze';
import type { EngineData, Iface, NetLink, NetNode, Network } from './types';

const domainsOf = (net: Network, data: EngineData) => analyze(net, data).l2.planDomains;


const data: EngineData = { wallAt: () => false };

const node = (uid: string, device: string, interfaces: Iface[] = [], configLocked = false): NetNode => ({ ports: [],
  uid,
  device,
  x: 0,
  y: 0,
  locked: false,
  configLocked,
  interfaces,
  gateway: null,
  routes: [],
  services: [],
});

const link = (uid: string, a: string, b: string): NetLink => {
  const [an, ap] = a.split(':');
  const [bn, bp] = b.split(':');
  return {
    uid,
    cable: 'utp_cat5e',
    a: { node: an, port: Number(ap) },
    b: { node: bn, port: Number(bp) },
    paid: 0,
    path: [
      [0, 0],
      [1, 0],
    ],
  };
};

describe('アドレスの計画の単位の L2 ドメイン', () => {
  it('配線で直結したPCは、1つのセグメントになる', () => {
    const net: Network = {
      nodes: [node('a', 'pc_basic'), node('b', 'pc_basic')],
      links: [link('l0', 'a:0', 'b:0')],
    };
    expect(domainsOf(net, data)).toEqual([{ key: 'a:0', members: [{ node: 'a', port: 0 }, { node: 'b', port: 0 }], wireless: [] }]);
  });

  it('スイッチを経由してつながった機器は、スイッチを除いて1つのセグメントになる', () => {
    const net: Network = {
      nodes: [node('a', 'pc_basic'), node('s', 'l2_switch_8p'), node('b', 'pc_basic'), node('c', 'pc_basic')],
      links: [link('l0', 'a:0', 's:0'), link('l1', 's:1', 'b:0'), link('l2', 's:2', 'c:0')],
    };
    const segs = domainsOf(net, data);
    expect(segs).toHaveLength(1);
    expect(segs[0].key).toBe('a:0');
    expect(segs[0].members.map((m) => m.node)).toEqual(['a', 'b', 'c']);
  });

  it('ルーターのポートで分かれたセグメントは、別々に数える', () => {
    const net: Network = {
      nodes: [node('a', 'pc_basic'), node('r', 'router_basic'), node('c', 'pc_basic')],
      links: [link('l0', 'a:0', 'r:0'), link('l1', 'r:1', 'c:0')],
    };
    const segs = domainsOf(net, data);
    expect(segs.map((s) => s.key)).toEqual(['a:0', 'c:0']);
    expect(segs[0].members).toEqual([
      { node: 'a', port: 0 },
      { node: 'r', port: 0 },
    ]);
  });

  it('L2 スイッチの VLAN で分けた機器は、別の L2 ドメインになる', () => {
    const sw: NetNode = { ...node('s', 'l2_switch_8p'), ports: [{ port: 0, mode: 'access', vlan: 10 }, { port: 1, mode: 'access', vlan: 10 }, { port: 2, mode: 'access', vlan: 20 }] };
    const net: Network = {
      nodes: [node('a', 'pc_basic'), sw, node('b', 'pc_basic'), node('c', 'pc_basic')],
      links: [link('l0', 'a:0', 's:0'), link('l1', 's:1', 'b:0'), link('l2', 's:2', 'c:0')],
    };
    expect(domainsOf(net, data).map((d) => [d.key, d.members.map((m) => m.node)])).toEqual([
      ['a:0', ['a', 'b']],
      ['c:0', ['c']],
    ]);
  });

  it('口の停止では分かれない（計画の範囲は設定で決まる）', () => {
    const sw: NetNode = { ...node('s', 'l2_switch_8p'), ports: [{ port: 1, mode: 'access', vlan: 1, shutdown: true }] };
    const net: Network = {
      nodes: [node('a', 'pc_basic'), sw, node('b', 'pc_basic')],
      links: [link('l0', 'a:0', 's:0'), link('l1', 's:1', 'b:0')],
    };
    expect(domainsOf(net, data).map((d) => d.members.map((m) => m.node))).toEqual([['a', 'b']]);
  });

  it('配線のない機器や、スイッチだけのつながりはセグメントにしない', () => {
    const net: Network = {
      nodes: [node('a', 'pc_basic'), node('s1', 'l2_switch_8p'), node('s2', 'l2_switch_8p')],
      links: [link('l0', 's1:0', 's2:0')],
    };
    expect(domainsOf(net, data)).toEqual([]);
  });
});

describe('L2 ドメインの計画', () => {
  it('案件で設定が固定された機器を含むセグメントは、その機器のアドレスから決まる', () => {
    const fixed = node('a', 'pc_basic', [{ id: "g0/0", kind: "port", port: 0, ip: '192.168.1.11', prefix: 24 }], true);
    const net: Network = { nodes: [fixed, node('b', 'pc_basic')], links: [link('l0', 'a:0', 'b:0')] };
    const [seg] = domainsOf(net, data);
    const nodes = new Map(net.nodes.map((n) => [n.uid, n]));
    // 保存された設定があっても、固定された機器のアドレスを優先する
    expect(planFor(seg, nodes, { 'a:0': { network: '10.0.0.0', prefix: 8 } })).toEqual({ network: '192.168.1.0', prefix: 24 });
  });

  it('設定のないセグメントは、IPアドレスのある機器のネットワークを設定にする（保存された設定は残す）', () => {
    const net: Network = {
      nodes: [node('a', 'pc_basic', [{ id: "g0/0", kind: "port", port: 0, ip: '192.168.1.11', prefix: 24 }]), node('b', 'pc_basic'), node('c', 'pc_basic', [{ id: "g0/0", kind: "port", port: 0, ip: '10.0.0.5', prefix: 8 }]), node('d', 'pc_basic')],
      links: [link('l0', 'a:0', 'b:0'), link('l1', 'c:0', 'd:0')],
      plans: { 'c:0': { network: '10.0.0.0', prefix: 16 } },
    };
    expect(fillPlans(analyze(net, data))).toEqual({
      'a:0': { network: '192.168.1.0', prefix: 24 },
      'c:0': { network: '10.0.0.0', prefix: 16 },
    });
  });
});

describe('アドレスの計算', () => {
  it('ネットワークアドレスを求める', () => {
    expect(networkAddress('192.168.1.77', 24)).toBe('192.168.1.0');
    expect(networkAddress('192.168.1.200', 25)).toBe('192.168.1.128');
  });

  it('ホストに使えるアドレスの数を求める（ネットワークアドレスとブロードキャストを除く）', () => {
    expect(hostCapacity(24)).toBe(254);
    expect(hostCapacity(30)).toBe(2);
    expect(hostCapacity(32)).toBe(0);
  });
});
