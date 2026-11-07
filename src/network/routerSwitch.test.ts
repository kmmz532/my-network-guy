// スイッチ付きルーター（WAN 1口・LAN 4口。LAN は内部でスイッチとして1つのセグメント）と L3 スイッチ（ルーターと同じ扱い）のテスト
import { describe, expect, it } from 'vitest';
import { compile } from './compile';
import { ping } from './engine';
import { nodeName, type NameContext } from './nodeName';
import { segmentsOf } from './segments';
import type { EngineData, Iface, NetLink, NetNode, Network, Route } from './types';

const data: EngineData = {
  categoryOf: (device) => ({ pc: 'pc', laptop: 'pc', router: 'router', rs: 'router_switch', l3: 'l3_switch', l2: 'l2_switch' })[device] ?? 'unknown',
  maxLengthOf: () => 100,
};

const node = (uid: string, device: string, interfaces: Iface[] = [], routes: Route[] = []): NetNode => ({
  uid,
  device,
  x: 0,
  y: 0,
  locked: false,
  configLocked: false,
  interfaces,
  gateway: null,
  routes,
  services: [],
});

const pc = (uid: string, ip?: string, gateway: string | null = null): NetNode => ({
  ...node(uid, 'pc', ip ? [{ port: 0, ip, prefix: 24 }] : []),
  gateway,
});

const link = (uid: string, a: string, aPort: number, b: string, bPort: number): NetLink => ({ paid: 0,
  uid,
  cable: 'utp_cat5e',
  a: { node: a, port: aPort },
  b: { node: b, port: bPort },
  path: [
    [0, 0],
    [1, 0],
  ],
});

describe('スイッチ付きルーターのセグメント', () => {
  it('LAN の口どうしは、つながった位置によらず同じセグメントになる', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.10'), pc('b', '192.168.1.11'), node('rs', 'rs', [{ port: 1, ip: '192.168.1.1', prefix: 24 }])],
      links: [link('l1', 'a', 0, 'rs', 1), link('l2', 'b', 0, 'rs', 3)],
    };
    const segs = segmentsOf(net, data);
    expect(segs).toHaveLength(1);
    expect(segs[0].members).toEqual([
      { node: 'a', port: 0 },
      { node: 'b', port: 0 },
      { node: 'rs', port: 1 },
    ]);
  });

  it('LAN の2つ目以降の口は、セグメントの一員に数えない', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.10'), node('rs', 'rs')],
      links: [link('l1', 'a', 0, 'rs', 3)],
    };
    const segs = segmentsOf(net, data);
    expect(segs).toHaveLength(1);
    expect(segs[0].members).toEqual([
      { node: 'a', port: 0 },
      { node: 'rs', port: 1 },
    ]);
  });

  it('WAN の口は LAN と別のセグメントになる', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.10'), pc('b', '10.0.0.10'), node('rs', 'rs')],
      links: [link('l1', 'a', 0, 'rs', 1), link('l2', 'b', 0, 'rs', 0)],
    };
    expect(segmentsOf(net, data)).toHaveLength(2);
  });
});

describe('スイッチ付きルーターの判定', () => {
  it('LAN の口につないだPC どうしは、同じネットワークなら通る', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.10'), pc('b', '192.168.1.11'), node('rs', 'rs', [{ port: 1, ip: '192.168.1.1', prefix: 24 }])],
      links: [link('l1', 'a', 0, 'rs', 1), link('l2', 'b', 0, 'rs', 4)],
    };
    expect(ping(net, data, 'a', 'b')).toMatchObject({ ok: true, path: ['a', 'b'] });
  });

  it('WAN と LAN の間を、静的ルートで経路を作って通る', () => {
    const net: Network = {
      nodes: [
        pc('a', '192.168.1.10', '192.168.1.1'),
        pc('b', '192.168.2.10', '192.168.2.1'),
        node(
          'rs',
          'rs',
          [
            { port: 0, ip: '10.0.0.1', prefix: 24 },
            { port: 1, ip: '192.168.1.1', prefix: 24 },
          ],
          [{ dest: '192.168.2.0', prefix: 24, nextHop: '10.0.0.2' }],
        ),
        node(
          'r2',
          'router',
          [
            { port: 0, ip: '10.0.0.2', prefix: 24 },
            { port: 1, ip: '192.168.2.1', prefix: 24 },
          ],
          [{ dest: '192.168.1.0', prefix: 24, nextHop: '10.0.0.1' }],
        ),
      ],
      links: [link('l1', 'a', 0, 'rs', 3), link('l2', 'rs', 0, 'r2', 0), link('l3', 'r2', 1, 'b', 0)],
    };
    const r = ping(net, data, 'a', 'b');
    expect(r.ok).toBe(true);
    expect(r.path).toEqual(['a', 'rs', 'r2', 'b']);
  });

  it('LAN の代表の口にアドレスがなければ、ゲートウェイに届かない', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.10', '192.168.1.1'), node('rs', 'rs')],
      links: [link('l1', 'a', 0, 'rs', 2)],
    };
    const r = ping(net, data, 'a', 'rs');
    expect(r.ok).toBe(false);
    expect(r.failure?.reason).toBe('ip.unset');
  });
});

describe('スイッチ付きルーターとL3スイッチの設定の判定', () => {
  it('LAN の口の機器は、代表の口のアドレスをゲートウェイにする', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.10'), node('rs', 'rs', [{ port: 1, ip: '192.168.1.1', prefix: 24 }])],
      links: [link('l1', 'a', 0, 'rs', 3)],
      segments: { 'a:0': { network: '192.168.1.0', prefix: 24 } },
    };
    const { net: compiled, issues } = compile(net, data);
    expect(compiled.nodes.find((n) => n.uid === 'a')?.gateway).toBe('192.168.1.1');
    expect(issues.a).toBeUndefined();
    expect(issues.rs).toBeUndefined();
  });

  it('LAN の代表の口にアドレスがなければ、スイッチ付きルーターに ip.unset を出す', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.10'), node('rs', 'rs')],
      links: [link('l1', 'a', 0, 'rs', 2)],
    };
    const { issues } = compile(net, data);
    expect(issues.rs?.reason).toBe('ip.unset');
  });

  it('LAN の2つ目以降の口に入ったアドレスは、設定から外す', () => {
    const net: Network = {
      nodes: [pc('a', '192.168.1.10'), node('rs', 'rs', [{ port: 3, ip: '192.168.1.1', prefix: 24 }])],
      links: [link('l1', 'a', 0, 'rs', 3)],
    };
    const { net: compiled } = compile(net, data);
    expect(compiled.nodes.find((n) => n.uid === 'rs')?.interfaces).toEqual([]);
  });

  it('L3スイッチは、ルーターと同じように2つのネットワークの間を経路で結ぶ', () => {
    const net: Network = {
      nodes: [
        pc('a', '192.168.1.10', '192.168.1.1'),
        pc('b', '192.168.2.10', '192.168.2.1'),
        node('l3', 'l3', [
          { port: 0, ip: '192.168.1.1', prefix: 24 },
          { port: 1, ip: '192.168.2.1', prefix: 24 },
        ]),
      ],
      links: [link('l1', 'a', 0, 'l3', 0), link('l2', 'l3', 1, 'b', 0)],
    };
    expect(ping(net, data, 'a', 'b')).toMatchObject({ ok: true, path: ['a', 'l3', 'b'] });
  });
});

describe('機器の名前（スイッチ付きルーターとL3スイッチ）', () => {
  const ctx: NameContext = {
    categoryOf: (device) => data.categoryOf(device),
    categoryLabel: (category) => ({ router_switch: 'スイッチ付きルーター', l3_switch: 'L3スイッチ' })[category] ?? category,
    ownedPc: (owner) => `${owner}のPC`,
  };

  it('種類ごとに番号を振る', () => {
    const nodes = [node('r', 'rs'), node('s', 'l3')];
    expect(nodeName(nodes[0], nodes, ctx)).toBe('スイッチ付きルーター-1');
    expect(nodeName(nodes[1], nodes, ctx)).toBe('L3スイッチ-1');
  });
});
