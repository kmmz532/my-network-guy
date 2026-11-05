import { describe, expect, it } from 'vitest';
import { fillSegments, hostCapacity, networkAddress, segmentConfigOf, segmentsOf } from './segments';
import type { EngineData, Iface, NetLink, NetNode, Network } from './types';

const data: EngineData = {
  categoryOf: (device) => ({ pc: 'pc', l2: 'l2_switch', router: 'router' })[device] ?? 'unknown',
  maxLengthOf: () => 100,
};

const node = (uid: string, device: string, interfaces: Iface[] = [], configLocked = false): NetNode => ({
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
    path: [
      [0, 0],
      [1, 0],
    ],
  };
};

describe('セグメントの算出', () => {
  it('配線で直結したPCは、1つのセグメントになる', () => {
    const net: Network = {
      nodes: [node('a', 'pc'), node('b', 'pc')],
      links: [link('l0', 'a:0', 'b:0')],
    };
    expect(segmentsOf(net, data)).toEqual([{ key: 'a:0', members: [{ node: 'a', port: 0 }, { node: 'b', port: 0 }] }]);
  });

  it('スイッチを経由してつながった機器は、スイッチを除いて1つのセグメントになる', () => {
    const net: Network = {
      nodes: [node('a', 'pc'), node('s', 'l2'), node('b', 'pc'), node('c', 'pc')],
      links: [link('l0', 'a:0', 's:0'), link('l1', 's:1', 'b:0'), link('l2', 's:2', 'c:0')],
    };
    const segs = segmentsOf(net, data);
    expect(segs).toHaveLength(1);
    expect(segs[0].key).toBe('a:0');
    expect(segs[0].members.map((m) => m.node)).toEqual(['a', 'b', 'c']);
  });

  it('ルーターのポートで分かれたセグメントは、別々に数える', () => {
    const net: Network = {
      nodes: [node('a', 'pc'), node('r', 'router'), node('c', 'pc')],
      links: [link('l0', 'a:0', 'r:0'), link('l1', 'r:1', 'c:0')],
    };
    const segs = segmentsOf(net, data);
    expect(segs.map((s) => s.key)).toEqual(['a:0', 'c:0']);
    expect(segs[0].members).toEqual([
      { node: 'a', port: 0 },
      { node: 'r', port: 0 },
    ]);
  });

  it('配線のない機器や、スイッチだけのつながりはセグメントにしない', () => {
    const net: Network = {
      nodes: [node('a', 'pc'), node('s1', 'l2'), node('s2', 'l2')],
      links: [link('l0', 's1:0', 's2:0')],
    };
    expect(segmentsOf(net, data)).toEqual([]);
  });
});

describe('セグメントの設定', () => {
  it('案件で設定が固定された機器を含むセグメントは、その機器のアドレスから決まる', () => {
    const fixed = node('a', 'pc', [{ port: 0, ip: '192.168.1.11', prefix: 24 }], true);
    const net: Network = { nodes: [fixed, node('b', 'pc')], links: [link('l0', 'a:0', 'b:0')] };
    const [seg] = segmentsOf(net, data);
    const nodes = new Map(net.nodes.map((n) => [n.uid, n]));
    // 保存された設定があっても、固定された機器のアドレスを優先する
    expect(segmentConfigOf(seg, nodes, { 'a:0': { network: '10.0.0.0', prefix: 8 } })).toEqual({ network: '192.168.1.0', prefix: 24 });
  });

  it('設定のないセグメントは、IPアドレスのある機器のネットワークを設定にする（保存された設定は残す）', () => {
    const net: Network = {
      nodes: [node('a', 'pc', [{ port: 0, ip: '192.168.1.11', prefix: 24 }]), node('b', 'pc'), node('c', 'pc', [{ port: 0, ip: '10.0.0.5', prefix: 8 }]), node('d', 'pc')],
      links: [link('l0', 'a:0', 'b:0'), link('l1', 'c:0', 'd:0')],
      segments: { 'c:0': { network: '10.0.0.0', prefix: 16 } },
    };
    expect(fillSegments(net, data)).toEqual({
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
