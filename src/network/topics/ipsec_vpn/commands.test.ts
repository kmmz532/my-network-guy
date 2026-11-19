// IPsec VPN の命令の解釈: 各命令が、トンネルの一覧（部品 vpn）をどう直すかを確かめる
import { describe, expect, it } from 'vitest';
import { commandContextOf, runLine } from '../../command/run';
import type { TerminalSession } from '../../command/types';
import type { NetworkState } from '../../engine/state';
import type { Tr } from '../../terminal';
import type { EngineData, NetNode } from '../../types';

type Tunnel = NonNullable<NonNullable<NetNode['components']>['vpn']>[number];

const tr: Tr = (key) => key;
// 引数も見えるように、キーと引数を並べる
const trArgs: Tr = (key, params) => `${key} ${JSON.stringify(params ?? {})}`;

const CONFIG: TerminalSession = { mode: 'config', iface: null, process: null };
const EXEC: TerminalSession = { mode: 'exec', iface: null, process: null };
const inMap = (name: string, seq: number): TerminalSession => ({ mode: 'crypto-map', iface: null, process: seq, map: name });

const entry = (over: Partial<Tunnel> = {}): Tunnel => ({ peer: '0.0.0.0', psk: '', cipher: 'aes', local: '0.0.0.0/0', remote: '0.0.0.0/0', map: 'VPN', seq: 10, ...over });
const router = (vpn: Tunnel[] = []): NetNode => ({ uid: 'ra', device: 'vpn_router', interfaces: [], routes: [], components: { vpn } }) as unknown as NetNode;
const ctxOf = (node: NetNode, session: TerminalSession = CONFIG, state = {} as NetworkState) =>
  commandContextOf({ node, nodes: [node], links: [], data: {} as EngineData, state }, false, session);

describe('IPsec VPN の命令', () => {
  it('crypto map は、同じ名前と番号のエントリがなければ作り、そのエントリのモードに入る', () => {
    const r = runLine('crypto map VPN 10 ipsec-isakmp', ctxOf(router()), tr);
    expect(r.change).toEqual({ kind: 'vpn', tunnels: [entry({ peer: '0.0.0.0', psk: '' })] });
    expect(r.session).toEqual(inMap('VPN', 10));
  });

  it('crypto map が同じエントリを指すときは、作らずにモードに入るだけ', () => {
    const r = runLine('crypto map VPN 10 ipsec-isakmp', ctxOf(router([entry()])), tr);
    expect(r.change).toBeNull();
    expect(r.session).toEqual(inMap('VPN', 10));
  });

  it('set peer・set transform-set・match address は、モードの対象のエントリだけを直す', () => {
    const node = router([entry(), entry({ map: 'OTHER', seq: 20 })]);
    const peer = runLine('set peer 198.51.100.2', ctxOf(node, inMap('VPN', 10)), tr);
    expect(peer.change).toEqual({ kind: 'vpn', tunnels: [entry({ peer: '198.51.100.2' }), entry({ map: 'OTHER', seq: 20 })] });

    const cipher = runLine('set transform-set 3des', ctxOf(node, inMap('VPN', 10)), tr);
    expect(cipher.change).toEqual({ kind: 'vpn', tunnels: [entry({ cipher: '3des' }), entry({ map: 'OTHER', seq: 20 })] });

    const match = runLine('match address 10.1.0.0 255.255.255.0 10.2.0.0 255.255.255.0', ctxOf(node, inMap('VPN', 10)), tr);
    expect(match.change).toEqual({ kind: 'vpn', tunnels: [entry({ local: '10.1.0.0/24', remote: '10.2.0.0/24' }), entry({ map: 'OTHER', seq: 20 })] });
  });

  it('transform-set は aes か 3des だけを受け付け、それ以外は誤りにする', () => {
    const r = runLine('set transform-set des', ctxOf(router([entry()]), inMap('VPN', 10)), tr);
    expect(r.change).toBeNull();
    expect(r.lines[0].text).toBe('ui.terminal.vpnCipher');
  });

  it('モードの対象のエントリがなければ、誤りにする', () => {
    const r = runLine('set peer 198.51.100.2', ctxOf(router(), inMap('VPN', 10)), tr);
    expect(r.change).toBeNull();
    expect(r.lines[0].text).toBe('ui.terminal.vpnNoMap');
  });

  it('crypto isakmp key は、その相手のエントリの鍵を置き換える。相手のエントリがなければ誤り', () => {
    const node = router([entry({ peer: '198.51.100.2' })]);
    const key = runLine('crypto isakmp key secret123 address 198.51.100.2', ctxOf(node), tr);
    expect(key.change).toEqual({ kind: 'vpn', tunnels: [entry({ peer: '198.51.100.2', psk: 'secret123' })] });

    const none = runLine('crypto isakmp key secret123 address 198.51.100.9', ctxOf(node), tr);
    expect(none.change).toBeNull();
    expect(none.lines[0].text).toBe('ui.terminal.vpnNoPeer');
  });

  it('no crypto isakmp key は鍵を空に、no crypto map はエントリを消す', () => {
    const node = router([entry({ peer: '198.51.100.2', psk: 'secret123' })]);
    expect(runLine('no crypto isakmp key address 198.51.100.2', ctxOf(node), tr).change).toEqual({
      kind: 'vpn',
      tunnels: [entry({ peer: '198.51.100.2', psk: '' })],
    });
    expect(runLine('no crypto map VPN 10', ctxOf(node), tr).change).toEqual({ kind: 'vpn', tunnels: [] });
  });

  it('show crypto session は、トンネルごとに相手と張れているか、張れない理由を出す', () => {
    const tunnel = entry({ peer: '198.51.100.2' });
    const state = {
      vpn: {
        tunnels: [
          { router: 'ra', index: 0, tunnel, ok: true, peer: 'rb', localIp: '203.0.113.2', peerIp: '198.51.100.2', peerPort: 0 },
          { router: 'ra', index: 1, tunnel: entry({ peer: '198.51.100.3' }), ok: false, reason: 'vpn.psk_mismatch' },
          { router: 'other', index: 0, tunnel, ok: true, peer: 'rb', localIp: '', peerIp: '', peerPort: 0 },
        ],
      },
    } as unknown as NetworkState;
    const r = runLine('show crypto session', ctxOf(router([tunnel]), EXEC, state), trArgs);
    expect(r.lines.map((l) => l.text)).toEqual([
      'ui.terminal.vpnUp {"peer":"198.51.100.2"}',
      'ui.terminal.vpnDown {"peer":"198.51.100.3","reason":"error.vpn.psk_mismatch {}"}',
    ]);
  });
});
