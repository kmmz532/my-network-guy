// サブインターフェース（router-on-a-stick）: スイッチのトランクとつないだルーターの1本の口が、タグ付きの VLAN ごとのインターフェースになる
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import { ping } from './engine';
import { analyze } from './engine/analyze';
import { makeSub } from './iface';
import type { EngineData, Iface, NetLink, NetNode, Network, PortConfig } from './types';
import type { NetworkState } from './engine/state';
import { parseIfaceName } from './command/args';
import { commandContextOf, runLine } from './command/run';
import type { TerminalSession } from './command/types';

const f = (port: number, ip: string, prefix = 24): Iface => ({ id: `eth${port}`, kind: 'port', port, ip, prefix });
const pc = (uid: string, ip: string, gateway: string): NetNode =>
  ({ uid, device: 'pc_basic', x: 0, y: 0, locked: false, configLocked: false, interfaces: [f(0, ip)], gateway, routes: [], services: [], ports: [] }) as NetNode;
const link = (uid: string, a: string, pa: number, b: string, pb: number): NetLink =>
  ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]] as [number, number][], paid: 0 }) as NetLink;

// スイッチの口0が VLAN 10、口2が VLAN 20、口1がルーターの g0/1 とのトランク。ルーターは g0/1.10・g0/1.20 を持つ
const build = (trunk: PortConfig, subs: readonly number[] = [10, 20]): Network => {
  const sw: NetNode = {
    uid: 'sw',
    device: 'l2_switch_4p',
    x: 1,
    y: 0,
    locked: false,
    configLocked: false,
    gateway: null,
    routes: [],
    services: [],
    interfaces: [],
    ports: [{ port: 0, mode: 'access', vlan: 10 }, trunk, { port: 2, mode: 'access', vlan: 20 }],
  } as NetNode;
  const router: NetNode = {
    uid: 'r',
    device: 'router_basic',
    x: 2,
    y: 0,
    locked: false,
    configLocked: false,
    gateway: null,
    routes: [],
    services: [],
    interfaces: subs.map((v) => makeSub('router_basic', 1, v, `192.168.${v}.1`, 24)),
    ports: [],
  } as NetNode;
  return {
    nodes: [pc('pc1', '192.168.10.10', '192.168.10.1'), pc('pc2', '192.168.20.10', '192.168.20.1'), sw, router],
    links: [link('l1', 'pc1', 0, 'sw', 0), link('l2', 'pc2', 0, 'sw', 2), link('l3', 'sw', 1, 'r', 1)],
    plans: {},
  };
};

describe('サブインターフェース', () => {
  it('トランク（10・20 を許可）の先のルーターのサブインターフェースが、VLAN の間を中継する', () => {
    const state = analyze(build({ port: 1, mode: 'trunk', allowed: [10, 20] }), gameEnv.engine);
    expect(ping(state, 'pc1', 'pc2').ok).toBe(true);
    expect(ping(state, 'pc2', 'pc1').ok).toBe(true);
  });

  it('サブインターフェースの VLAN をトランクが許可していなければ届かない', () => {
    const state = analyze(build({ port: 1, mode: 'trunk', allowed: [10] }), gameEnv.engine);
    expect(ping(state, 'pc1', 'pc2').ok).toBe(false);
  });

  it('ルーターにその VLAN のサブインターフェースがなければ、タグ付きのフレームは受け取られず届かない', () => {
    const state = analyze(build({ port: 1, mode: 'trunk', allowed: [10, 20] }, [10]), gameEnv.engine);
    expect(ping(state, 'pc1', 'pc2').ok).toBe(false);
  });

  it('ルーターの口を抜く・止めると、サブインターフェースから出られず届かない', () => {
    const net = build({ port: 1, mode: 'trunk', allowed: [10, 20] });
    const unplugged = { ...net, links: net.links.filter((l) => l.uid !== 'l3') };
    expect(ping(analyze(unplugged, gameEnv.engine), 'pc1', 'pc2').ok).toBe(false);
  });
});

describe('サブインターフェースのターミナル', () => {
  const run = (line: string, session: TerminalSession) =>
    runLine(line, commandContextOf({ node: { uid: 'N1', device: 'router_basic', ports: [], interfaces: [], routes: [] } as unknown as NetNode, nodes: [], links: [], data: {} as EngineData, state: {} as NetworkState }, false, session), (key) => key);

  it('interface g0/1.10 に入り、ip address でサブインターフェースを作る。encapsulation は名前の VLAN だけ受け付ける', () => {
    expect(parseIfaceName('router_basic', 'g0/1.10')).toEqual({ kind: 'sub', port: 1, vlan: 10 });
    const entered = run('interface g0/1.10', { mode: 'config', iface: null, process: null });
    expect(entered.session).toEqual({ mode: 'interface', iface: { kind: 'sub', port: 1, vlan: 10 }, process: null });
    const session = entered.session as TerminalSession;
    expect(run('ip address 192.168.10.1 255.255.255.0', session).change).toEqual({ kind: 'sub', parent: 1, vlan: 10, ip: '192.168.10.1', prefix: 24 });
    expect(run('encapsulation dot1q 10', session).lines.some((l) => l.kind === 'err')).toBe(false);
    expect(run('encapsulation dot1q 20', session).lines).toEqual([{ text: 'ui.terminal.errEncapsulation', kind: 'err' }]);
  });
});
