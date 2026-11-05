import { describe, expect, it } from 'vitest';
import { runTerminal, type Tr } from './terminal';
import type { EngineData, NetLink, NetNode } from './types';

const data: EngineData = {
  categoryOf: (device) => ({ pc: 'pc', l2: 'l2_switch' })[device] ?? 'unknown',
  maxLengthOf: () => 30,
};

const pc = (uid: string, ip: string | null, gateway: string | null = null): NetNode => ({
  uid,
  device: 'pc',
  x: 0,
  y: 0,
  locked: false,
  configLocked: false,
  interfaces: ip ? [{ port: 0, ip, prefix: 24 }] : [],
  gateway,
  routes: [],
  services: [],
});

const sw = (uid: string): NetNode => ({ ...pc(uid, null), device: 'l2' });

const link = (uid: string, a: string, aPort: number, b: string, bPort: number): NetLink => ({
  uid,
  cable: 'utp_cat5e',
  a: { node: a, port: aPort },
  b: { node: b, port: bPort },
  path: [
    [0, 0],
    [5, 0],
    [5, 0],
  ],
});

// 翻訳の代わりに、キーと引数をそのまま返す
const tr: Tr = (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key);

const nodes = [pc('a', '192.168.1.10', '192.168.1.1'), pc('b', '192.168.1.11'), sw('s')];
const links = [link('l1', 'a', 0, 's', 0), link('l2', 'b', 0, 's', 1)];

describe('ターミナルのコマンド', () => {
  it('空の行は何も出さない。help は一覧を出す', () => {
    const ctx = { node: nodes[0], nodes, links, data };
    expect(runTerminal('   ', ctx, tr)).toEqual([]);
    expect(runTerminal('help', ctx, tr)).toEqual([{ text: 'ui.terminal.help', kind: 'out' }]);
  });

  it('show ip は、ポートごとのIPアドレスと、ゲートウェイを出す', () => {
    const ctx = { node: nodes[0], nodes, links, data };
    const lines = runTerminal('show ip', ctx, tr);
    expect(lines.map((l) => l.text)).toEqual([
      'ui.terminal.ifLine {"port":0,"ip":"192.168.1.10","prefix":24}',
      'ui.terminal.gateway {"gateway":"192.168.1.1"}',
    ]);
  });

  it('IPアドレスがない機器の show ip は、その旨を出す', () => {
    const ctx = { node: sw('s'), nodes, links, data };
    expect(runTerminal('show ip', ctx, tr)).toEqual([{ text: 'ui.terminal.noIp', kind: 'out' }]);
  });

  it('ping は、届けば成功、届かなければ失敗の理由を出す', () => {
    const ctx = { node: nodes[0], nodes, links, data };
    expect(runTerminal('ping 192.168.1.11', ctx, tr)).toEqual([{ text: 'ui.terminal.pingOk {"ip":"192.168.1.11"}', kind: 'out' }]);
    const far = { node: nodes[0], nodes: [nodes[0], pc('c', '192.168.2.10')], links: [], data };
    const lines = runTerminal('ping 192.168.2.10', far, tr);
    expect(lines[0]).toEqual({ text: 'ui.terminal.pingNg', kind: 'err' });
    expect(lines[1].text).toBe('error.link.unplugged');
  });

  it('引数が合わない・宛先がない・知らないコマンドは、理由を出す', () => {
    const ctx = { node: nodes[0], nodes, links, data };
    expect(runTerminal('ping', ctx, tr)).toEqual([{ text: 'ui.terminal.usagePing', kind: 'err' }]);
    expect(runTerminal('ping 10.0.0.1', ctx, tr)[0].text).toBe('ui.terminal.noHost {"ip":"10.0.0.1"}');
    expect(runTerminal('reboot', ctx, tr)).toEqual([{ text: 'ui.terminal.unknown {"cmd":"reboot"}', kind: 'err' }]);
  });
});

describe('確認のコマンド（段階2）', () => {
  const ctx = (node: NetNode, extra: Partial<NetNode> = {}) => ({
    node: { ...node, ...extra },
    nodes: nodes.map((n) => (n.uid === node.uid ? { ...n, ...extra } : n)),
    links,
    data,
  });

  it('show interfaces は、ポートごとの接続先とIPを出す', () => {
    const lines = runTerminal('show interfaces', ctx(nodes[0]), tr);
    expect(lines.map((l) => l.text)).toEqual(['ui.terminal.ifLinkedIp {"port":0,"ip":"192.168.1.10","prefix":24,"peer":"s"}']);
  });

  it('show ip route は、直結の経路と既定のゲートウェイを出す', () => {
    const lines = runTerminal('show ip route', ctx(nodes[0]), tr);
    expect(lines.map((l) => l.text)).toEqual([
      'ui.terminal.routeConnected {"net":"192.168.1.0","prefix":24,"port":0}',
      'ui.terminal.routeStatic {"dest":"0.0.0.0","prefix":0,"nextHop":"192.168.1.1"}',
    ]);
  });

  it('show running-config は、設定を並べて出す（設定がなければその旨）', () => {
    const lines = runTerminal('show running-config', ctx(nodes[0]), tr);
    expect(lines[0].text).toBe('ui.terminal.cfgInterface {"port":0}');
    expect(lines[1].text).toBe('ui.terminal.cfgAddress {"ip":"192.168.1.10","prefix":24}');
    expect(runTerminal('show running-config', ctx(sw('s')), tr)).toEqual([{ text: 'ui.terminal.cfgEmpty', kind: 'out' }]);
  });

  it('traceroute は、通った機器（L2スイッチを除く）を1台ずつ出す（送信元は含めない）', () => {
    const lines = runTerminal('traceroute 192.168.1.11', { node: nodes[0], nodes, links, data }, tr);
    // L2スイッチは経路に含めないため、宛先の1行だけになる
    expect(lines).toEqual([{ text: 'ui.terminal.hop {"n":1,"ip":"192.168.1.11","name":"b"}', kind: 'out' }]);
  });

  it('traceroute は、届かないと止まった場所の理由を出す', () => {
    const far = { node: nodes[0], nodes: [nodes[0], pc('c', '192.168.2.10')], links: [], data };
    const lines = runTerminal('traceroute 192.168.2.10', far, tr);
    expect(lines.map((l) => l.text)).toEqual(['ui.terminal.traceNg', 'error.link.unplugged']);
    expect(lines[0].kind).toBe('err');
  });

  it('未知の show の下位コマンドは unknown を出す', () => {
    expect(runTerminal('show foo', { node: nodes[0], nodes, links, data }, tr)[0].kind).toBe('err');
  });
});

import { completeLine } from './terminal';

describe('補完（Tab）', () => {
  it('候補が1つなら、続きを書き足して空白を付ける', () => {
    expect(completeLine('sh')).toBe('show ');
    expect(completeLine('show ip r')).toBe('show ip route ');
    expect(completeLine('ip add')).toBe('ip address ');
  });

  it('候補が複数なら、共通の続きまで書き足す。候補がなければ変えない', () => {
    expect(completeLine('show i')).toBe('show i');
    expect(completeLine('no ip ')).toBe('no ip ');
    expect(completeLine('xyz')).toBe('xyz');
    expect(completeLine('ip ')).toBe('ip ');
  });
});
