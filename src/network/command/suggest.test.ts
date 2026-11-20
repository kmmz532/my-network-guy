import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { NetNode } from '../types';
import { canonicalLine, commandContextOf } from './run';
import { suggest, questionList } from './suggest';
import type { ArgKind, CommandContext, TerminalSession } from './types';
import type { EngineData } from '../types';
import type { NetworkState } from '../engine/state';

const exec: TerminalSession = { mode: 'exec', iface: null, process: null };
const config: TerminalSession = { mode: 'config', iface: null, process: null };

const node = (uid: string, device: string, ips: string[] = []): NetNode =>
  ({ uid, device, ports: [], interfaces: ips.map((ip, port) => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24 })), routes: [] }) as unknown as NetNode;

const router = node('R', 'router_basic', ['10.0.0.1']);
const peer = node('S', 'router_basic', ['10.0.0.2']);

const ctxOf = (session: TerminalSession, over: Partial<CommandContext> = {}): CommandContext => ({
  ...commandContextOf(
    { node: router, nodes: [router, peer], links: [{ uid: 'l', a: { node: 'R', port: 0 }, b: { node: 'S', port: 0 } }] as never, data: {} as EngineData, state: {} as NetworkState },
    false,
    session,
  ),
  ...over,
});

describe('suggest', () => {
  it('履歴は文法の予測より先に出し、最も新しい行を選ぶ', () => {
    const ctx = ctxOf(exec);
    expect(suggest('show ip', ctx, ['show ip route', 'show ip rip database']).ghost).toBe(' rip database');
    expect(suggest('sh', ctx, []).ghost).toBe('ow ');
    expect(suggest('conf', ctx, []).ghost).toBe('igure ');
  });

  it('文法に合わない履歴と、解放前の論点の履歴は出さない', () => {
    expect(suggest('switchport', ctxOf(exec), ['switchport 1 access vlan 10', 'switchport 1 foo']).ghost).toBe(' 1 access vlan 10');
    expect(suggest('ip address', ctxOf(exec), ['ip address dhcp']).ghost).toBe('');
    expect(suggest('ip address', ctxOf({ mode: 'interface', iface: { kind: 'port', port: 1 }, process: null }), ['ip address dhcp']).ghost).toBe(' dhcp');
    const locked = ctxOf(exec, { unlocked: (topic) => topic !== 'vlan' });
    expect(suggest('switchport', locked, ['switchport 1 access vlan 10']).ghost).toBe('');
  });

  it('interface の後は、まだ設定していない口の名前の先頭を予測する', () => {
    const ctx = ctxOf(config);
    expect(suggest('interface ', ctx, []).candidates.map((c) => c.word).slice(0, 2)).toEqual(['port-channel', 'g0/1']);
  });

  it('neighbor の後は、隣接する機器のアドレスを候補にする', () => {
    const ctx = ctxOf({ mode: 'router-bgp', iface: null, process: 65000 });
    expect(suggest('neighbor ', ctx, []).candidates.map((c) => c.word)).toEqual(['10.0.0.2']);
  });

  it('略記は展開した正式な形で履歴に残す', () => {
    expect(canonicalLine('sh ip ro', exec)).toBe('show ip route');
    expect(canonicalLine('conf t', exec)).toBe('configure terminal');
    expect(canonicalLine('ping 10.0.0.2', exec)).toBe('ping 10.0.0.2');
    expect(canonicalLine('xyz', exec)).toBe('xyz');
  });

  it('文法に合わない語の位置を返す。打っている途中の引数は誤りにしない', () => {
    const ctx = ctxOf(exec);
    expect(suggest('show foo', ctx, []).errorAt).toBe(5);
    expect(suggest('show ip route', ctx, []).errorAt).toBeNull();
    expect(suggest('sh ip ro', ctx, []).errorAt).toBeNull();
    expect(suggest('ping 10.0', ctx, []).errorAt).toBeNull();
    expect(suggest('ping 10.0 x', ctx, []).errorAt).toBe(5);
  });

  it('解放前の論点の命令は、候補に出さない', () => {
    const locked = ctxOf(exec, { unlocked: (topic) => topic !== 'vlan' });
    expect(suggest('show ', locked, []).candidates.map((c) => c.word)).not.toContain('mac');
    expect(suggest('show ', ctxOf(exec), []).candidates.map((c) => c.word)).toContain('mac');
  });

  it('教材の中（hideValues）では、予測と候補に引数の値を出さず、? には形だけを出す', () => {
    const ctx = ctxOf(config, { hideValues: true });
    expect(suggest('interface ', ctx, [])).toMatchObject({ ghost: 'port-channel ', candidates: [{ word: 'port-channel' }] });
    expect(questionList('interface ', ctx).map((c) => c.word)).toEqual(['port-channel', '<interface>']);
    const bgp = ctxOf({ mode: 'router-bgp', iface: null, process: 65000 }, { hideValues: true });
    expect(suggest('neighbor ', bgp, []).candidates).toEqual([]);
    expect(questionList('neighbor ', bgp).map((c) => c.word)).toEqual(['<A.B.C.D>']);
  });

  it('? は、その位置の語と説明の鍵を出し、行を終えられる位置には <cr> を出す', () => {
    const ctx = ctxOf(exec);
    expect(questionList('show ip ro', ctx)).toEqual([{ word: 'route', help: 'ui.cmd.static_route.showIpRoute' }]);
    expect(questionList('show ip route ', ctx).map((c) => c.word)).toEqual(['<cr>']);
  });
});

// 命令の木のすべての位置で、候補の説明の鍵が言語ファイルにある
describe('候補の説明', () => {
  const lang = JSON.parse(readFileSync(new URL('../../assets/lang/ja_jp.json', import.meta.url), 'utf8')) as Record<string, string>;
  const SAMPLE: Record<ArgKind, string> = {
    iface: 'g0/1', ip: '10.0.0.1', mask: '255.255.255.0', wildcard: '0.0.0.255', prefix: '24', vlan: '10', vlanList: '10,20', area: '0', asn: '65000',
    vrid: '1', channel: '1', ssid: 'abc', psk: 'password1', cost: '10', number: '1', word: 'x', hostname: 'host', hostOrIp: '10.0.0.1', mac: '02:10:00:00:01:00',
  };
  it('どのモードの、どの位置の候補にも説明がある', () => {
    const missing = new Set<string>();
    const seen = new Set<string>();
    const visit = (line: string, session: TerminalSession) => {
      if (seen.has(`${session.mode}|${line}`)) return;
      seen.add(`${session.mode}|${line}`);
      const ctx = ctxOf(session, { hideValues: true });
      for (const c of questionList(line, ctx)) {
        if (!Object.hasOwn(lang, c.help)) missing.add(c.help);
        if (c.word === '<cr>') continue;
        const kind = (Object.keys(SAMPLE) as ArgKind[]).find((k) => c.help === `ui.cmdArg.${k}`);
        visit(`${line}${kind === undefined ? c.word : SAMPLE[kind]} `, session);
      }
    };
    for (const mode of ['exec', 'config', 'interface', 'router-rip', 'router-ospf', 'router-bgp'] as const) {
      visit('', { mode, iface: mode === 'interface' ? { kind: 'port', port: 1 } : null, process: null });
    }
    expect([...missing]).toEqual([]);
  });
});
