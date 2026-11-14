// 修理の依頼（r001〜r010）: 置かれた状態のままでは不合格で、壊れ方を1つ直すと合格する。症状だけが依頼文にあり、原因は書かれていない
import { describe, expect, it } from 'vitest';
import r001 from '../assets/data/contracts/r001_duplicate_ip.json';
import r002 from '../assets/data/contracts/r002_wrong_gateway.json';
import r003 from '../assets/data/contracts/r003_loop.json';
import r005 from '../assets/data/contracts/r005_vlan_trunk.json';
import r006 from '../assets/data/contracts/r006_ospf_hello.json';
import r007 from '../assets/data/contracts/r007_ospf_area.json';
import r008 from '../assets/data/contracts/r008_wireless_wpa3.json';
import r009 from '../assets/data/contracts/r009_bgp_as.json';
import r010 from '../assets/data/contracts/r010_dhcp_rogue.json';
import r004 from '../assets/data/contracts/r004_mask.json';
import lang from '../assets/lang/ja_jp.json';
import type { Contract } from '../data/schema';
import { analyze } from '../network/engine/analyze';
import { evaluateGoal } from '../network/goals';
import type { NetLink, NetNode } from '../network/types';
import { gameEnv } from './env';
import { contractLinks, fixedNodes } from './project';

const passes = (contract: Contract, nodes: NetNode[], links: NetLink[]): boolean => {
  const state = analyze({ nodes, links, plans: {} }, gameEnv.engine);
  return contract.goals.every((g) => evaluateGoal(g, state).every((r) => r.ok));
};

// 最初の状態の機器から、1台の設定を書き換える
const withIface = (nodes: NetNode[], uid: string, ip: string, prefix: number): NetNode[] =>
  nodes.map((n) => (n.uid === uid ? { ...n, interfaces: n.interfaces.map((i) => ({ ...i, ip, prefix })) } : n));

describe('修理の依頼', () => {
  const cases: { contract: Contract; fix: (nodes: NetNode[], links: NetLink[]) => { nodes: NetNode[]; links: NetLink[] } }[] = [
    { contract: r001 as unknown as Contract, fix: (nodes, links) => ({ nodes: withIface(nodes, 'pc_new', '192.168.1.14', 24), links }) },
    { contract: r002 as unknown as Contract, fix: (nodes, links) => ({ nodes: nodes.map((n) => (n.uid === 'router' ? { ...n, interfaces: n.interfaces.map((i) => (i.ip === '192.168.3.1' ? { ...i, ip: '192.168.2.1' } : i)) } : n)), links }) },
    { contract: r003 as unknown as Contract, fix: (nodes, links) => ({ nodes, links: links.filter((l) => !(l.a.node === 'sw' && l.a.port === 4)) }) },
    { contract: r005 as unknown as Contract, fix: (nodes, links) => ({ nodes: nodes.map((n) => (n.uid.startsWith('sw_') ? { ...n, ports: n.ports.map((p) => (p.mode === 'trunk' ? { ...p, allowed: [10, 20] } : p)) } : n)), links }) },
    { contract: r006 as unknown as Contract, fix: (nodes, links) => ({ nodes: nodes.map((n) => (n.uid === 'r3' ? { ...n, interfaces: n.interfaces.map((i) => (i.ospf?.hello ? { ...i, ospf: { area: i.ospf.area } } : i)) } : n)), links }) },
    { contract: r007 as unknown as Contract, fix: (nodes, links) => ({ nodes: nodes.map((n) => (n.uid === 'r2' ? { ...n, interfaces: n.interfaces.map((i) => (i.port === 0 ? { ...i, ospf: { area: 0 } } : i)) } : n)), links }) },
    { contract: r008 as unknown as Contract, fix: (nodes, links) => ({ nodes: nodes.map((n) => (n.uid === 'ap' ? { ...n, wireless: { ...n.wireless, security: 'wpa2wpa3' } } : n)), links }) },
    { contract: r009 as unknown as Contract, fix: (nodes, links) => ({ nodes: nodes.map((n) => (n.uid === 'edge' && n.bgp ? { ...n, bgp: { ...n.bgp, neighbors: n.bgp.neighbors.map((x) => (x.ip === '203.0.113.1' ? { ...x, remoteAs: 65002 } : x)) } } : n)), links }) },
    { contract: r010 as unknown as Contract, fix: (nodes, links) => ({ nodes: nodes.map((n) => (n.uid === 'home' ? { ...n, dhcpPools: [] } : n)), links }) },
    { contract: r004 as unknown as Contract, fix: (nodes, links) => ({ nodes: withIface(nodes, 'pc_new', '192.168.1.20', 24), links }) },
  ];
  for (const { contract, fix } of cases) {
    describe(contract.id, () => {
      const nodes = fixedNodes(contract);
      const links = contractLinks(contract);
      it('そのままでは不合格', () => {
        expect(passes(contract, nodes, links)).toBe(false);
      });
      it('原因を直すと合格', () => {
        const fixed = fix(nodes, links);
        expect(passes(contract, fixed.nodes, fixed.links)).toBe(true);
      });
      it('依頼は修理の型で、機器の設定を変えられる', () => {
        expect(contract.kind).toBe('repair');
        expect(nodes.filter((n) => !n.configLocked && n.interfaces.length > 0).length).toBeGreaterThan(0);
      });
    });
  }

  it('依頼文に、原因の言葉を書かない', () => {
    const texts = (lang as Record<string, string>);
    for (const id of ['r001_duplicate_ip', 'r002_wrong_gateway', 'r003_loop', 'r004_mask', 'r005_vlan_trunk', 'r006_ospf_hello', 'r007_ospf_area', 'r008_wireless_wpa3', 'r009_bgp_as', 'r010_dhcp_rogue']) {
      const text = [texts[`contract.${id}.title`], texts[`contract.${id}.story`]].join('');
      expect(text).not.toMatch(/重複|ゲートウェイ|アドレス|ループ|輪|プレフィックス|サブネット|マスク|同じIP|トランク|許可|VLAN|OSPF|Hello|ハロー|隣接|エリア|バックボーン|WPA|暗号|SSID|BGP|AS番号|AS 番号|ピア|DHCP|プール|家庭用|割り当て/);
    }
  });
});
