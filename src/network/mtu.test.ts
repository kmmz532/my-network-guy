// MTU: 区間の MTU（両端の口の小さい方・トンネルの包みの分）と、分割・DF での停止・adjust-mss
import { describe, expect, it } from 'vitest';
import { lessons } from 'virtual:game-data';
import balanceJson from '../assets/data/balance.json';
import type { Balance } from '../data/schema';
import { solutions } from '../__golden__/solutions';
import { initialOffice } from '../sim/furniture';
import { lessonLinks, lessonNodes } from '../sim/lesson';
import { setIfaceTune } from '../sim/netEdit';
import type { Core } from '../sim/project';
import { http, ping } from './engine';
import { analyze } from './engine/analyze';
import type { EngineData, Iface, NetLink, NetNode } from './types';

const engine: EngineData = { wallAt: () => false, interferers: [] };

const f = (port: number, ip: string, extra: Partial<Iface> = {}): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24, ...extra });
const n = (uid: string, device: string, interfaces: Iface[], x: number, extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device, x, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports: [], macSerial: x + 1, ...extra }) as NetNode;
const l = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });

// PC a - ルーター r - PC b。口の MTU を指定できる
const lan = (mtus: { a?: number; rA?: number; rB?: number; b?: number }, adjustMss?: number) => {
  const nodes = [
    n('a', 'pc_basic', [f(0, '10.0.1.10', { mtu: mtus.a })], 0, { gateway: '10.0.1.1' }),
    n('r', 'router_basic', [f(0, '10.0.1.1', { mtu: mtus.rA, adjustMss }), f(1, '10.0.2.1', { mtu: mtus.rB })], 1),
    n('b', 'pc_basic', [f(0, '10.0.2.10', { mtu: mtus.b })], 2, { gateway: '10.0.2.1', services: [{ protocol: 'http', port: 80 }] }),
  ];
  return analyze({ nodes, links: [l('l1', 'a', 0, 'r', 0), l('l2', 'r', 1, 'b', 0)] }, engine);
};

describe('区間の MTU', () => {
  it('両端の口の小さい方になる。DF なしは分割して届き、DF ありはその区間の入口の機器で止まる', () => {
    // 区間 r-b は、r の口が 1200・b の口が 1000 なので、小さい方の 1000
    const s = lan({ rB: 1200, b: 1000 });
    expect(ping(s, 'a', 'b', { size: 1000, df: true }).ok).toBe(true);
    const blocked = ping(s, 'a', 'b', { size: 1001, df: true });
    expect(blocked.ok).toBe(false);
    expect(blocked.failure).toEqual({ reason: 'mtu.exceeded', node: 'r' });
    const split = ping(s, 'a', 'b', { size: 1500 });
    expect(split.ok).toBe(true);
    // 区間 a-r はそのまま、区間 r-b で分割（1000 バイトの区間に 1480 バイトのデータ: 976 バイトずつで2つ）
    expect(split.fragments).toEqual([1, 2]);
    // 復路は r から a へ。r-b の区間の時点で分割済みのため、そのあとの区間も2つのまま
    expect(split.backFragments).toEqual([2, 2]);
  });

  it('既定の大きさ（100 バイト）は、MTU を下げても分割されない', () => {
    const r = ping(lan({ rB: 576 }), 'a', 'b');
    expect(r.ok).toBe(true);
    expect(r.fragments).toBeUndefined();
  });

  it('送信元の口の MTU を超える DF の通信は、送信元で止まる', () => {
    expect(ping(lan({ a: 1000 }), 'a', 'b', { size: 1200, df: true }).failure).toEqual({ reason: 'mtu.exceeded', node: 'a' });
  });
});

describe('adjust-mss', () => {
  it('HTTP の大きさを 値 + 40 に抑えて分割を避ける。ping の大きさは変えない', () => {
    // 区間 r-b を 1400 にする。HTTP は 1500 のため分割される
    const base = lan({ rB: 1400 });
    expect(http(base, 'a', 'b', 80).fragments).toEqual([1, 2]);
    // r の口に adjust-mss 1360（= 1400 - 40）を入れると、1400 で収まる
    const clamped = lan({ rB: 1400 }, 1360);
    const web = http(clamped, 'a', 'b', 80);
    expect(web.ok).toBe(true);
    expect(web.fragments).toBeUndefined();
    expect(ping(clamped, 'a', 'b', { size: 1500 }).fragments).toEqual([1, 2]);
  });
});

describe('IPsec のトンネルの MTU', () => {
  const lesson = lessons.find((x) => x.id === 'mtu_vpn');
  if (!lesson) throw new Error('教材 mtu_vpn がない');
  const solved = (mutate: (nodes: NetNode[]) => NetNode[] = (x) => x) => analyze({ nodes: mutate(solutions.mtu_vpn(lessonNodes(lesson))), links: lessonLinks(lesson) }, engine);

  it('トンネルの包みの分、区間の MTU が小さくなり、DF 付きの 1500 は通らない。DF なしは分割して届く', () => {
    const s = solved();
    expect(ping(s, 'HQ_PC', 'BR_PC', { size: 1400, df: true }).ok).toBe(true);
    const blocked = ping(s, 'HQ_PC', 'BR_PC', { size: 1500, df: true });
    expect(blocked.failure).toEqual({ reason: 'mtu.exceeded', node: 'HQ_VPN' });
    // 1500 - 73 = 1427 のトンネルの区間から先は、2つに分割されたまま
    expect(ping(s, 'HQ_PC', 'BR_PC', { size: 1500 }).fragments).toEqual([1, 2, 2]);
  });

  it('入口の WAN の口の MTU を下げると、通っていた大きさが通らなくなる', () => {
    const lowered = solved((nodes) => nodes.map((x) => (x.uid === 'HQ_VPN' ? { ...x, interfaces: x.interfaces.map((i) => (i.port === 0 ? { ...i, mtu: 1400 } : i)) } : x)));
    expect(ping(lowered, 'HQ_PC', 'BR_PC', { size: 1400, df: true }).failure).toEqual({ reason: 'mtu.exceeded', node: 'HQ_VPN' });
  });

  it('戻りのトンネルの口の MTU が小さいと、復路で止まる', () => {
    const lowered = solved((nodes) => nodes.map((x) => (x.uid === 'BR_VPN' ? { ...x, interfaces: x.interfaces.map((i) => (i.port === 0 ? { ...i, mtu: 1400 } : i)) } : x)));
    expect(ping(lowered, 'HQ_PC', 'BR_PC', { size: 1400, df: true }).failure).toEqual({
      reason: 'return.failed',
      node: 'BR_PC',
      cause: { reason: 'mtu.exceeded', node: 'BR_VPN' },
    });
  });
});

describe('口の MTU の設定', () => {
  const core = (): Core => ({ office: { ...initialOffice(balanceJson as unknown as Balance), nodes: [n('r', 'router_basic', [f(0, '10.0.1.1')], 0)] }, active: [], focus: null, owned: {} }) as unknown as Core;

  it('576〜9000 の整数だけを受け、範囲の外は拒否する', () => {
    for (const bad of [575, 9001, 1500.5]) expect(setIfaceTune(core(), 'r', 0, 'mtu', bad, 'office')).toEqual({ ok: false, reason: 'mtu.range' });
    for (const ok of [576, 9000]) {
      const r = setIfaceTune(core(), 'r', 0, 'mtu', ok, 'office');
      expect(r.ok && r.core.office.nodes[0].interfaces[0].mtu).toBe(ok);
    }
  });

  it('adjust-mss の範囲の外も拒否する', () => {
    expect(setIfaceTune(core(), 'r', 0, 'adjustMss', 535, 'office')).toEqual({ ok: false, reason: 'mtu.mss_range' });
  });
});
