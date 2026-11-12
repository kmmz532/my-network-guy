// ホップごとのフレーム。直結・スイッチ・ルーターの3つの構成で、MAC の付け替えと TTL を確かめる
import { describe, expect, it } from 'vitest';
import { framesOf, type FrameContext } from './frames';
import { macOf } from './mac';
import type { NetLink, NetNode, PathResult } from './types';

const node = (uid: string, device: string, macSerial: number, ifaces: { port: number; ip: string }[]): NetNode =>
  ({ uid, device, macSerial, interfaces: ifaces, ports: [], x: 0, y: 0, locked: false, configLocked: false, gateway: null, routes: [], services: [] }) as unknown as NetNode;
const link = (uid: string, a: string, ap: number, b: string, bp: number): NetLink =>
  ({ uid, cable: 'utp_cat5e', a: { node: a, port: ap }, b: { node: b, port: bp }, path: [], paid: 0 }) as NetLink;
const CATEGORY: Record<string, string> = { pc: 'pc', router: 'router', l2_switch: 'l2_switch' };
const ctxOf = (nodes: NetNode[], links: NetLink[]): FrameContext => ({
  nodes,
  links,
  categoryOf: (d) => CATEGORY[d] ?? 'unknown',
  isSwitch: (uid) => nodes.find((n) => n.uid === uid)?.device === 'l2_switch',
  isRouter: (uid) => nodes.find((n) => n.uid === uid)?.device === 'router',
});
const ok = (path: string[]): PathResult => ({ ok: true, path });

describe('ホップごとのフレーム', () => {
  it('直結は、1本のリンクに1つのフレームを出す（TTL は 64）', () => {
    const nodes = [node('p1', 'pc', 1, [{ port: 0, ip: '10.0.0.1' }]), node('p2', 'pc', 2, [{ port: 0, ip: '10.0.0.2' }])];
    const frames = framesOf(ctxOf(nodes, [link('l1', 'p1', 0, 'p2', 0)]), ok(['p1', 'p2']));
    expect(frames).toEqual([
      {
        link: 'l1',
        from: 'p1',
        to: 'p2',
        l2: { srcMac: macOf('pc', 1, 0), dstMac: macOf('pc', 2, 0), vlan: null },
        l3: { srcIp: '10.0.0.1', dstIp: '10.0.0.2', ttl: 64, proto: 'icmp' },
      },
    ]);
  });

  it('スイッチを通ると、リンクごとにフレームが出るが、MAC と TTL は変わらない', () => {
    const nodes = [
      node('p1', 'pc', 1, [{ port: 0, ip: '10.0.0.1' }]),
      node('sw', 'l2_switch', 3, []),
      node('p2', 'pc', 2, [{ port: 0, ip: '10.0.0.2' }]),
    ];
    const frames = framesOf(ctxOf(nodes, [link('l1', 'p1', 0, 'sw', 0), link('l2', 'sw', 1, 'p2', 0)]), ok(['p1', 'p2']));
    expect(frames.map((f) => f.link)).toEqual(['l1', 'l2']);
    expect(frames.map((f) => f.l2.srcMac)).toEqual([macOf('pc', 1, 0), macOf('pc', 1, 0)]);
    expect(frames.map((f) => f.l3.ttl)).toEqual([64, 64]);
  });

  it('ルーターを越えると、MAC が付け替わり、TTL が 1 減る', () => {
    const nodes = [
      node('p1', 'pc', 1, [{ port: 0, ip: '10.0.1.10' }]),
      node('r1', 'router', 4, [{ port: 0, ip: '10.0.1.1' }, { port: 1, ip: '10.0.2.1' }]),
      node('p2', 'pc', 2, [{ port: 0, ip: '10.0.2.10' }]),
    ];
    const frames = framesOf(ctxOf(nodes, [link('l1', 'p1', 0, 'r1', 0), link('l2', 'r1', 1, 'p2', 0)]), ok(['p1', 'r1', 'p2']));
    expect(frames).toHaveLength(2);
    expect(frames[0].l2).toEqual({ srcMac: macOf('pc', 1, 0), dstMac: macOf('router', 4, 0), vlan: null });
    expect(frames[1].l2).toEqual({ srcMac: macOf('router', 4, 1), dstMac: macOf('pc', 2, 0), vlan: null });
    expect(frames[0].l3).toMatchObject({ srcIp: '10.0.1.10', dstIp: '10.0.2.10', ttl: 64 });
    expect(frames[1].l3).toMatchObject({ srcIp: '10.0.1.10', dstIp: '10.0.2.10', ttl: 63 });
  });

  it('経路が失敗していれば、フレームは出さない', () => {
    expect(framesOf(ctxOf([], []), { ok: false, path: [] })).toEqual([]);
  });
});
