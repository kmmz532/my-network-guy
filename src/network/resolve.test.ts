// 名前の解決（N68）。対応表 → ネームサーバーの順、ネームサーバーまで届かなければ失敗
import { describe, expect, it } from 'vitest';
import { resolveName } from './resolve';
import { evaluateGoal } from './goals';
import type { EngineData, NetLink, NetNode } from './types';

const data: EngineData = {
  categoryOf: (device) => ({ pc: 'pc', l2: 'l2_switch' })[device] ?? 'unknown',
  maxLengthOf: () => 30,
};

const host = (uid: string, ip: string, extra: Partial<NetNode> = {}): NetNode => ({
  uid,
  device: 'pc',
  x: 0,
  y: 0,
  locked: false,
  configLocked: false,
  interfaces: [{ port: 0, ip, prefix: 24 }],
  gateway: null,
  routes: [],
  services: [],
  ...extra,
});

const sw: NetNode = { ...host('s', '0.0.0.0'), device: 'l2', interfaces: [] };
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

// a（PC）・b（PC）・d（DNS サーバー）を、スイッチ s につなぐ
const dnsServer = host('d', '192.168.1.20', { dns: { zone: [{ name: 'fileserver', ip: '192.168.1.20' }, { name: 'PC-2', ip: '192.168.1.11' }] } });
const base = () => ({
  nodes: [host('a', '192.168.1.10', { nameServer: '192.168.1.20' }), host('b', '192.168.1.11'), sw, dnsServer],
  links: [link('l1', 'a', 0, 's', 0), link('l2', 'b', 0, 's', 1), link('l3', 'd', 0, 's', 2)],
});

describe('名前の解決', () => {
  it('機器の対応表にあれば、それを使う（ネームサーバーは見ない）', () => {
    const net = base();
    const from = { ...net.nodes[0], hosts: [{ name: 'PC-2', ip: '192.168.1.99' }] };
    expect(resolveName(from, 'PC-2', { nodes: [from, ...net.nodes.slice(1)], links: net.links }, data)).toEqual({
      ok: true,
      ip: '192.168.1.99',
      via: 'hosts',
    });
  });

  it('対応表になければ、ネームサーバーの表を引く（届く場合）', () => {
    const net = base();
    expect(resolveName(net.nodes[0], 'fileserver', net, data)).toEqual({ ok: true, ip: '192.168.1.20', via: 'dns', server: 'd' });
  });

  it('ネームサーバーまで届かなければ、解決できない（表に名前があっても）', () => {
    const net = base();
    const unplugged = { ...net, links: net.links.filter((l) => l.uid !== 'l3') };
    expect(resolveName(net.nodes[0], 'fileserver', unplugged, data)).toEqual({ ok: false, reason: 'dns.unreachable', server: 'd' });
  });

  it('表にない名前は、見つからない', () => {
    const net = base();
    expect(resolveName(net.nodes[0], 'nothing', net, data)).toEqual({ ok: false, reason: 'not_found', server: 'd' });
  });

  it('ネームサーバーを設定していなければ、対応表になければ見つからない', () => {
    const net = base();
    const plain = { ...net.nodes[0], nameServer: undefined };
    expect(resolveName(plain, 'fileserver', net, data)).toEqual({ ok: false, reason: 'not_found' });
  });

  it('ネームサーバーの IPアドレスの機器が DNS でなければ、答えるものがない', () => {
    const net = base();
    const notDns = { ...dnsServer, dns: undefined };
    const changed = { ...net, nodes: net.nodes.map((n) => (n.uid === 'd' ? notDns : n)) };
    expect(resolveName(net.nodes[0], 'fileserver', changed, data)).toEqual({ ok: false, reason: 'dns.unreachable' });
  });
});

// 目標 reach_by_name（N68）: すべての PC が、名前で指定の機器へ届く
describe('目標 reach_by_name', () => {
  const dataWithServer: EngineData = {
    categoryOf: (device) => ({ pc: 'pc', srv: 'server', l2: 'l2_switch' })[device] ?? 'unknown',
    maxLengthOf: () => 30,
  };
  const build = (unplugFileserver: boolean) => {
    const file = host('d', '192.168.1.20', { device: 'srv', hostname: 'fileserver', dns: { zone: [{ name: 'fileserver', ip: '192.168.1.20' }] } });
    const pc = (uid: string, ip: string) => host(uid, ip, { nameServer: '192.168.1.20', hostname: `PC-${uid}` });
    const nodes = [pc('a', '192.168.1.10'), pc('b', '192.168.1.11'), sw, file];
    const links = [link('l1', 'a', 0, 's', 0), link('l2', 'b', 0, 's', 1), link('l3', 'd', 0, 's', 2)];
    return { nodes, links: unplugFileserver ? links.filter((l) => l.uid !== 'l3') : links };
  };

  it('すべての PC が名前で届けば合格する', () => {
    const net = build(false);
    const results = evaluateGoal({ type: 'reach_by_name', name: 'fileserver' }, net, dataWithServer);
    expect(results.map((r) => r.ok)).toEqual([true, true]);
  });

  it('名前を引けなければ、理由は「名前を解決できない」', () => {
    const net = build(true);
    const results = evaluateGoal({ type: 'reach_by_name', name: 'fileserver' }, net, dataWithServer);
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(results[0].failure?.reason).toBe('name.unresolved');
  });
});
