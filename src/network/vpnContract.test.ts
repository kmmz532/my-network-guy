// 案件 v001（本社と支社を IPsec VPN でつなぐ）: 両拠点に VPN ルーターを置いて配線し、両方に対になるトンネルを設定すると合格する。鍵が違うと不合格
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import { makeIface } from './iface';
import contractJson from '../assets/data/contracts/v001_vpn_two_sites.json';
import { gameEnv } from '../sim/env';
import { contractLinks, fixedNodes } from '../sim/project';
import type { Contract } from '../data/schema';
import { evaluateContract } from './goals';
import type { NetLink, NetNode, Network } from './types';

const contract = contractJson as unknown as Contract;
const data = gameEnv.engine;

type Tunnel = NonNullable<NonNullable<NetNode['components']>['vpn']>[number];

const cable = (uid: string, a: string, aPort: number, b: string, bPort: number): NetLink => ({
  uid,
  cable: 'utp_cat5e',
  a: { node: a, port: aPort },
  b: { node: b, port: bPort },
  path: [
    [0, 0],
    [1, 0],
  ],
  paid: 0,
});

// 機器の上に置く VPN ルーター。口0 が WAN（回線の側）、口1 が LAN（PC の側）
const vpnRouter = (uid: string, x: number, wan: string, lan: string, gateway: string, tunnel: Tunnel): NetNode =>
  ({
    uid,
    device: 'vpn_router',
    x,
    y: 0,
    locked: false,
    configLocked: false,
    interfaces: [makeIface('vpn_router', 0, wan, 24), makeIface('vpn_router', 1, lan, 24)],
    gateway,
    routes: [],
    services: [],
    ports: [],
    macSerial: x + 100,
    components: { vpn: [tunnel] },
  }) as unknown as NetNode;

const HQ: Tunnel = { peer: '203.0.113.2', psk: 'tunnel-key-42', cipher: 'aes', local: '10.1.0.0/24', remote: '10.2.0.0/24' };
const BR: Tunnel = { peer: '198.51.100.2', psk: 'tunnel-key-42', cipher: 'aes', local: '10.2.0.0/24', remote: '10.1.0.0/24' };

// 正解: 両拠点の VPN ルーターを配線し、対になるトンネルを設定する。brKey は支社の鍵（違うと不合格）
const net = (brKey: string): Network => {
  const nodes: NetNode[] = [
    ...fixedNodes(contract),
    vpnRouter('HQ_VPN', 5, '198.51.100.2', '10.1.0.1', '198.51.100.1', HQ),
    vpnRouter('BR_VPN', 30, '203.0.113.2', '10.2.0.1', '203.0.113.1', { ...BR, psk: brKey }),
  ];
  const links: NetLink[] = [
    ...contractLinks(contract),
    cable('hq_pc', 'HQ_PC', 0, 'HQ_VPN', 1),
    cable('hq_wan', 'HQ_VPN', 0, 'HQ_LINE', 0),
    cable('br_pc', 'BR_PC', 0, 'BR_VPN', 1),
    cable('br_wan', 'BR_VPN', 0, 'BR_LINE', 0),
  ];
  return { nodes, links, plans: {} };
};

describe('案件 v001: 本社と支社を IPsec VPN でつなぐ', () => {
  it('両拠点に対になるトンネルを設定すると合格する', () => {
    expect(evaluateContract(contract, analyze(net('tunnel-key-42'), data)).passed).toBe(true);
  });

  it('支社の事前共有鍵が違うと不合格', () => {
    expect(evaluateContract(contract, analyze(net('tunnel-key-99'), data)).passed).toBe(false);
  });
});
