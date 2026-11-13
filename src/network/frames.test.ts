// ホップごとのフレーム。直結・スイッチ・ルーターの3つの構成で、MAC の付け替えと TTL を確かめる
import { describe, expect, it } from 'vitest';
import { deviceCategory } from '../registry/query';
import { framesOf, type FrameContext } from './frames';
import { macOf } from './mac';
import { vrrpMac } from './vrrp';
import type { NetLink, NetNode, PathResult, PortConfig } from './types';

const node = (uid: string, device: string, macSerial: number, ifaces: { port: number; ip: string }[]): NetNode =>
  ({ uid, device, macSerial, interfaces: ifaces, ports: [], x: 0, y: 0, locked: false, configLocked: false, gateway: null, routes: [], services: [] }) as unknown as NetNode;
const link = (uid: string, a: string, ap: number, b: string, bp: number): NetLink =>
  ({ uid, cable: 'utp_cat5e', a: { node: a, port: ap }, b: { node: b, port: bp }, path: [], paid: 0 }) as NetLink;
const ctxOf = (nodes: NetNode[], links: NetLink[]): FrameContext => ({
  nodes,
  links,
  categoryOf: deviceCategory,
  isSwitch: (uid) => nodes.find((n) => n.uid === uid)?.device === 'l2_switch_8p',
  isRouter: (uid) => nodes.find((n) => n.uid === uid)?.device === 'router_basic',
});
const ok = (path: string[]): PathResult => ({ ok: true, path });

describe('ホップごとのフレーム', () => {
  it('直結は、1本のリンクに1つのフレームを出す（TTL は 64）', () => {
    const nodes = [node('p1', 'pc_basic', 1, [{ port: 0, ip: '10.0.0.1' }]), node('p2', 'pc_basic', 2, [{ port: 0, ip: '10.0.0.2' }])];
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
      node('p1', 'pc_basic', 1, [{ port: 0, ip: '10.0.0.1' }]),
      node('sw', 'l2_switch_8p', 3, []),
      node('p2', 'pc_basic', 2, [{ port: 0, ip: '10.0.0.2' }]),
    ];
    const frames = framesOf(ctxOf(nodes, [link('l1', 'p1', 0, 'sw', 0), link('l2', 'sw', 1, 'p2', 0)]), ok(['p1', 'p2']));
    expect(frames.map((f) => f.link)).toEqual(['l1', 'l2']);
    expect(frames.map((f) => f.l2.srcMac)).toEqual([macOf('pc', 1, 0), macOf('pc', 1, 0)]);
    expect(frames.map((f) => f.l3.ttl)).toEqual([64, 64]);
  });

  it('ルーターを越えると、MAC が付け替わり、TTL が 1 減る', () => {
    const nodes = [
      node('p1', 'pc_basic', 1, [{ port: 0, ip: '10.0.1.10' }]),
      node('r1', 'router_basic', 4, [{ port: 0, ip: '10.0.1.1' }, { port: 1, ip: '10.0.2.1' }]),
      node('p2', 'pc_basic', 2, [{ port: 0, ip: '10.0.2.10' }]),
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

describe('VLAN・NAT・HTTP のフレーム', () => {
  const sw = (uid: string, cfg: PortConfig[]): NetNode => ({ ...node(uid, 'l2_switch_8p', 3, []), ports: cfg }) as NetNode;
  it('トランクの区間だけに 802.1Q のタグが付く（native VLAN は付かない）', () => {
    const nodes = [
      node('p1', 'pc_basic', 1, [{ port: 0, ip: '10.0.20.1' }]),
      sw('s1', [{ port: 0, mode: 'access', vlan: 20 }, { port: 1, mode: 'trunk', native: 1 }]),
      sw('s2', [{ port: 1, mode: 'trunk', native: 1 }, { port: 0, mode: 'access', vlan: 20 }]),
      node('p2', 'pc_basic', 2, [{ port: 0, ip: '10.0.20.2' }]),
    ];
    const links = [link('l1', 'p1', 0, 's1', 0), link('l2', 's1', 1, 's2', 1), link('l3', 's2', 0, 'p2', 0)];
    const frames = framesOf(ctxOf(nodes, links), ok(['p1', 'p2']));
    expect(frames.map((f) => f.l2.vlan)).toEqual([null, 20, null]);
  });

  it('NAPT を通ると、変換の後のフレームは外のアドレスになり、変換の前の値が付く', () => {
    const nodes = [
      node('p1', 'pc_basic', 1, [{ port: 0, ip: '10.0.1.10' }]),
      node('r1', 'router_basic', 4, [{ port: 0, ip: '10.0.1.1' }, { port: 1, ip: '203.0.113.1' }]),
      node('srv', 'pc_basic', 5, [{ port: 0, ip: '198.51.100.8' }]),
    ];
    const links = [link('l1', 'p1', 0, 'r1', 0), link('l2', 'r1', 1, 'srv', 0)];
    const result: PathResult = { ok: true, path: ['p1', 'r1', 'srv'], nat: { router: 'r1', insideIp: '10.0.1.10', outsideIp: '203.0.113.1' } };
    const frames = framesOf(ctxOf(nodes, links), result, { kind: 'http', port: 80 });
    expect(frames[0].l3.srcIp).toBe('10.0.1.10');
    expect(frames[1].l3.srcIp).toBe('203.0.113.1');
    expect(frames[1].nat?.before).toMatchObject({ srcIp: '10.0.1.10', dstIp: '198.51.100.8' });
    expect(frames[0].nat).toBeUndefined();
  });

  it('HTTP は TCP で、宛先のポートは指定どおり。送信元は一時ポート（49152 以上）で、同じ通信なら同じ値', () => {
    const nodes = [node('p1', 'pc_basic', 1, [{ port: 0, ip: '10.0.0.1' }]), node('p2', 'pc_basic', 2, [{ port: 0, ip: '10.0.0.2' }])];
    const ctx = ctxOf(nodes, [link('l1', 'p1', 0, 'p2', 0)]);
    const a = framesOf(ctx, ok(['p1', 'p2']), { kind: 'http', port: 80 });
    const b = framesOf(ctx, ok(['p1', 'p2']), { kind: 'http', port: 80 });
    expect(a[0].l3.proto).toBe('tcp');
    expect(a[0].l4?.dstPort).toBe(80);
    expect(a[0].l4!.srcPort).toBeGreaterThanOrEqual(49152);
    expect(a[0].l4).toEqual(b[0].l4);
  });
});

describe('復路と静的 NAT のフレーム', () => {
  it('復路のフレームは、往路と逆向きに出る（宛先と送信元が入れ替わる）', () => {
    const nodes = [node('p1', 'pc_basic', 1, [{ port: 0, ip: '10.0.0.1' }]), node('p2', 'pc_basic', 2, [{ port: 0, ip: '10.0.0.2' }])];
    const frames = framesOf(ctxOf(nodes, [link('l1', 'p1', 0, 'p2', 0)]), { ok: true, path: ['p1', 'p2'], back: ['p2', 'p1'] });
    expect(frames).toHaveLength(2);
    expect(frames[1]).toMatchObject({ from: 'p2', to: 'p1', l3: { srcIp: '10.0.0.2', dstIp: '10.0.0.1' } });
  });

  it('静的 NAT は往路の宛先を、変換したルーターの後で社内のアドレスに変える', () => {
    const nodes = [
      node('p1', 'pc_basic', 1, [{ port: 0, ip: '203.0.113.50' }]),
      node('r1', 'router_basic', 4, [{ port: 0, ip: '203.0.113.1' }, { port: 1, ip: '10.0.2.1' }]),
      node('srv', 'pc_basic', 5, [{ port: 0, ip: '10.0.2.5' }]),
    ];
    const links = [link('l1', 'p1', 0, 'r1', 0), link('l2', 'r1', 1, 'srv', 0)];
    const result: PathResult = { ok: true, path: ['p1', 'r1', 'srv'], staticNat: { router: 'r1', insideIp: '10.0.2.5', outsideIp: '203.0.113.1' } };
    const frames = framesOf(ctxOf(nodes, links), result, { kind: 'http', port: 80 });
    expect(frames[0].l3.dstIp).toBe('203.0.113.1');
    expect(frames[1].l3.dstIp).toBe('10.0.2.5');
    expect(frames[1].nat?.before).toMatchObject({ dstIp: '203.0.113.1' });
  });
});

describe('VRRP の仮想 MAC', () => {
  it('ゲートウェイが仮想の IP アドレスなら、ルーターへ向かうフレームの宛先の MAC は仮想 MAC になる', () => {
    const r1 = { ...node('r1', 'router_basic', 4, [{ port: 0, ip: '10.0.1.1' }, { port: 1, ip: '10.0.2.1' }]) };
    r1.interfaces = [{ id: 'g0', kind: 'port', port: 0, ip: '10.0.1.1', prefix: 24, vrrp: [{ vrid: 7, ip: '10.0.1.254', priority: 110, preempt: true }] }, r1.interfaces[1]];
    const p1 = { ...node('p1', 'pc_basic', 1, [{ port: 0, ip: '10.0.1.10' }]), gateway: '10.0.1.254' };
    const nodes = [p1, r1, node('p2', 'pc_basic', 2, [{ port: 0, ip: '10.0.2.10' }])];
    const frames = framesOf(ctxOf(nodes, [link('l1', 'p1', 0, 'r1', 0), link('l2', 'r1', 1, 'p2', 0)]), ok(['p1', 'r1', 'p2']));
    expect(frames[0].l2.dstMac).toBe(vrrpMac(7));
    expect(frames[1].l2.dstMac).toBe(macOf('pc', 2, 0));
    // 実の IP アドレスをゲートウェイにしていれば、実の MAC
    const real = framesOf(ctxOf([{ ...p1, gateway: '10.0.1.1' }, r1, nodes[2]], [link('l1', 'p1', 0, 'r1', 0), link('l2', 'r1', 1, 'p2', 0)]), ok(['p1', 'r1', 'p2']));
    expect(real[0].l2.dstMac).toBe(macOf('router', 4, 0));
  });
});
