import { analyze } from './engine/analyze';
import { dhcpOf } from './query/dhcp';
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import { dhcpWriteBack, ping } from './netState';
import { writeBackDhcp, type Core } from '../sim/project';
import type { Iface, NetLink, NetNode, Network } from './types';

const data = gameEnv.engine;
const st = (ip: string, prefix = 24, extra: Partial<Iface> = {}): Iface => ({ id: 'eth0', kind: 'port', port: 0, ip, prefix, ...extra });
const node = (uid: string, device: string, serial: number, extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device, macSerial: serial, x: 0, y: 0, locked: false, configLocked: false, interfaces: [], gateway: null, routes: [], services: [], ports: [], ...extra }) as NetNode;
const link = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });
const pool = { network: '192.168.1.0', prefix: 24, start: '192.168.1.100', end: '192.168.1.101' };
const client = (uid: string, serial: number) => node(uid, 'pc_basic', serial, { interfaces: [st('', 24, { dhcp: true })] });

// SW に DHCP サーバー SRV（192.168.1.2）と PC を並べる
const office = (clients: string[], srvPool = pool): Network => ({
  nodes: [
    node('sw', 'l2_switch_8p', 1),
    node('srv', 'server_basic', 2, { interfaces: [st('192.168.1.2')], dhcpPools: [srvPool] }),
    ...clients.map((c, i) => client(c, 10 + i)),
  ],
  links: [link('s', 'sw', 0, 'srv', 0), ...clients.map((c, i) => link(`l${c}`, 'sw', i + 1, c, 0))],
  segments: {},
});

describe('DHCP', () => {
  it('同じドメインのサーバーのプールから、小さいアドレスから順に配り、通信できる', () => {
    const net = office(['p1', 'p2']);
    expect(dhcpOf(analyze(net, data)).leases.map((l) => [l.uid, l.ip])).toEqual([['p1', '192.168.1.100'], ['p2', '192.168.1.101']]);
    expect(ping(net, data, 'p1', 'p2').ok).toBe(true);
  });
  it('プールが足りなければ dhcp.exhausted、サーバーがなければ dhcp.no_offer', () => {
    const net = office(['p1', 'p2', 'p3']);
    expect(dhcpOf(analyze(net, data)).failed).toEqual([{ uid: 'p3', port: 0, reason: 'dhcp.exhausted' }]);
    expect(ping(net, data, 'p3', 'p1').failure?.reason).toBe('dhcp.exhausted');
    const none: Network = { ...net, nodes: net.nodes.map((n) => (n.uid === 'srv' ? { ...n, dhcpPools: undefined } : n)) };
    expect(ping(none, data, 'p1', 'p2').failure?.reason).toBe('dhcp.no_offer');
  });
  it('サーバーが2台あれば、連番の小さい機器から受け取り、両方を記録する', () => {
    const net = office(['p1']);
    const two: Network = {
      ...net,
      nodes: [...net.nodes, node('srv2', 'home_router', 0, { interfaces: [st('192.168.1.1')], dhcpPools: [{ ...pool, start: '192.168.1.50', end: '192.168.1.60' }] })],
      links: [...net.links, link('r', 'sw', 5, 'srv2', 0)],
    };
    const r = dhcpOf(analyze(two, data));
    expect(r.leases[0]).toMatchObject({ ip: '192.168.1.50', server: 'srv2' });
    expect(r.multiple).toHaveLength(1);
  });
  it('除外の範囲のアドレスは配らない', () => {
    const net = office(['p1']);
    const excluding: Network = { ...net, nodes: net.nodes.map((n) => (n.uid === 'srv' ? { ...n, dhcpPools: [{ ...pool, excluded: [{ start: '192.168.1.100', end: '192.168.1.100' }] }] } : n)) };
    expect(dhcpOf(analyze(excluding, data)).leases[0].ip).toBe('192.168.1.101');
  });
  it('手動のアドレスと重なる DHCP のアドレスは ip.duplicate.dhcp になる', () => {
    const net = office(['p1']);
    const manual: Network = {
      ...net,
      nodes: [...net.nodes, node('m', 'pc_basic', 1, { interfaces: [st('192.168.1.100')] })],
      links: [...net.links, link('lm', 'sw', 2, 'm', 0)],
    };
    expect(dhcpOf(analyze(manual, data)).leases.map((l) => l.ip)).toEqual(['192.168.1.100']);
    expect(ping(manual, data, 'p1', 'm').failure?.reason).toBe('ip.duplicate.dhcp');
  });
  it('ルーターを越えるときは、リレー（helper）を設定したルーターの口のサブネットのプールから配る', () => {
    const net: Network = {
      nodes: [
        node('srv', 'server_basic', 2, { interfaces: [st('10.0.0.2', 24)], dhcpPools: [{ network: '192.168.1.0', prefix: 24, start: '192.168.1.100', end: '192.168.1.110', gateway: '192.168.1.1' }] }),
        node('r1', 'router_basic', 3, { interfaces: [{ id: 'g0/0', kind: 'port', port: 0, ip: '10.0.0.1', prefix: 24 }, { id: 'g0/1', kind: 'port', port: 1, ip: '192.168.1.1', prefix: 24, helper: '10.0.0.2' }] }),
        client('p1', 10),
      ],
      links: [link('a', 'srv', 0, 'r1', 0), link('b', 'r1', 1, 'p1', 0)],
      segments: {},
    };
    expect(dhcpOf(analyze(net, data)).leases[0]).toMatchObject({ uid: 'p1', ip: '192.168.1.100' });
    const noHelper: Network = { ...net, nodes: net.nodes.map((n) => (n.uid === 'r1' ? { ...n, interfaces: n.interfaces.map((i) => ({ ...i, helper: undefined })) } : n)) };
    expect(dhcpOf(analyze(noHelper, data)).failed[0].reason).toBe('dhcp.no_offer');
  });
});

describe('DHCP のターミナル', () => {
  it('ip address dhcp・ip helper-address・ip dhcp pool を読み、show ip dhcp binding は配ったアドレスを出す', async () => {
    const { parseConfig } = await import('./terminalConfig');
    const { runTerminal } = await import('./terminal');
    const tr = (k: string, p?: Record<string, unknown>) => (p ? `${k} ${JSON.stringify(p)}` : k);
    expect(parseConfig('ip address 0 dhcp', tr)).toEqual({ kind: 'action', action: { kind: 'dhcp', op: 'client', port: 0 } });
    expect(parseConfig('ip helper-address 1 10.0.0.2', tr)).toEqual({ kind: 'action', action: { kind: 'dhcp', op: 'helper', port: 1, ip: '10.0.0.2' } });
    expect(parseConfig('no ip helper-address 1', tr)).toEqual({ kind: 'action', action: { kind: 'dhcp', op: 'helper', port: 1, ip: null } });
    expect(parseConfig('ip dhcp pool 192.168.1.0 255.255.255.0 192.168.1.100 192.168.1.150 gateway 192.168.1.1', tr)).toEqual({
      kind: 'action',
      action: { kind: 'dhcp', op: 'pool', pool: { network: '192.168.1.0', prefix: 24, start: '192.168.1.100', end: '192.168.1.150', gateway: '192.168.1.1' } },
    });
    expect(parseConfig('ip dhcp pool 192.168.1.0 255.255.255.0 192.168.1.100', tr)).toEqual({ kind: 'error', text: 'ui.terminal.usageDhcp' });
    const net = office(['p1']);
    const lines = runTerminal('show ip dhcp binding', { node: net.nodes[1], nodes: net.nodes, links: net.links, data }, tr);
    expect(lines[0].text).toContain('192.168.1.100');
  });
});

describe('DHCP の前回のアドレス', () => {
  it('書き戻したあとは、PC を1台消しても、ほかの PC のアドレスは変わらない。書き戻しのあとに計算しても結果は同じ', () => {
    const net = office(['p1', 'p2']);
    const saved = dhcpWriteBack(net.nodes, net.links, net.segments, data);
    const written: Network = { ...net, nodes: [...saved] };
    expect(written.nodes.find((n) => n.uid === 'p2')?.interfaces[0].ip).toBe('192.168.1.101');
    expect(dhcpOf(analyze(written, data)).leases.map((l) => l.ip)).toEqual(['192.168.1.100', '192.168.1.101']);
    expect(dhcpWriteBack(written.nodes, written.links, written.segments, data)).toBe(written.nodes);
    const removed: Network = { ...written, nodes: written.nodes.filter((n) => n.uid !== 'p1'), links: written.links.filter((l) => l.uid !== 'lp1') };
    expect(dhcpOf(analyze(removed, data)).leases).toMatchObject([{ uid: 'p2', ip: '192.168.1.101' }]);
  });
  it('前回のアドレスがプールの範囲外になれば、取り直す。受け取れない間は前回のアドレスを書き換えない', () => {
    const net = office(['p1']);
    const written: Network = { ...net, nodes: [...dhcpWriteBack(net.nodes, net.links, net.segments, data)] };
    const moved: Network = { ...written, nodes: written.nodes.map((n) => (n.uid === 'srv' ? { ...n, dhcpPools: [{ ...pool, start: '192.168.1.150', end: '192.168.1.160' }] } : n)) };
    expect(dhcpOf(analyze(moved, data)).leases[0].ip).toBe('192.168.1.150');
    const gone: Network = { ...written, nodes: written.nodes.map((n) => (n.uid === 'srv' ? { ...n, dhcpPools: undefined } : n)) };
    expect(dhcpWriteBack(gone.nodes, gone.links, gone.segments, data)).toBe(gone.nodes);
    expect(gone.nodes.find((n) => n.uid === 'p1')?.interfaces[0].ip).toBe('192.168.1.100');
  });
});

describe('DHCP の書き戻し（store）', () => {
  it('操作の確定のあとに、受け取ったアドレスを機器へ書き戻す。書き戻すものがなければ同じ core を返す', () => {
    const net = office(['p1', 'p2']);
    const core = { office: { nodes: net.nodes, links: net.links, segments: net.segments ?? {} }, active: [] } as unknown as Core;
    const written = writeBackDhcp(core, gameEnv);
    expect(written.office.nodes.find((n) => n.uid === 'p2')?.interfaces[0].ip).toBe('192.168.1.101');
    expect(writeBackDhcp(written, gameEnv)).toBe(written);
  });
});
