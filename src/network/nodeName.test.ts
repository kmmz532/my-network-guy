import { describe, expect, it } from 'vitest';
import { deviceCategory } from '../registry/query';
import { nodeName, renameNode, type NameContext } from './nodeName';
import type { NetNode } from './types';

const node = (uid: string, device: string, x = 0, y = 0, name?: string): NetNode => ({ ports: [],
  uid,
  device,
  x,
  y,
  locked: false,
  configLocked: false,
  interfaces: [],
  gateway: null,
  routes: [],
  services: [],
  ...(name ? { name } : {}),
});

const LABEL: Record<string, string> = { pc: 'PC', server: 'サーバー', l2_switch: 'スイッチ' };
const ROLE: Record<string, string> = { 'ui.node.role.web': 'Webサーバー', 'ui.node.role.dns': 'DNSサーバー', 'ui.node.role.radius': 'RADIUSサーバー', 'ui.node.role.proxy': 'プロキシサーバー', 'ui.node.role.multi': '複合サーバー' };

const WEB = { protocol: 'http' as const, port: 80 };
const DNS = { protocol: 'dns' as const, role: 'auth' as const, zone: [] };
const served = (uid: string, services: NetNode['services']): NetNode => ({ ...node(uid, 'server_basic'), services });
const ctx = (owners: Record<string, string> = {}): NameContext => ({
  categoryOf: deviceCategory,
  categoryLabel: (c) => LABEL[c] ?? c,
  ownedPc: (owner) => `${owner}のPC`,
  ownerAt: (x, y) => owners[`${x},${y}`] ?? null,
  tr: (key) => ROLE[key] ?? key,
});

describe('機器の名前', () => {
  const nodes = [node('a', 'pc_basic', 1, 1), node('b', 'server_basic'), node('c', 'pc_basic', 2, 1), node('d', 'l2_switch_8p')];

  it('座る社員がいないPCは、種類ごとの番号で呼ぶ', () => {
    expect(nodeName(nodes[0], nodes, ctx())).toBe('PC-1');
    expect(nodeName(nodes[2], nodes, ctx())).toBe('PC-2');
  });

  it('座る社員がいるPCは「{社員名}のPC」', () => {
    expect(nodeName(nodes[2], nodes, ctx({ '2,1': '田中' }))).toBe('田中のPC');
  });

  it('PC以外は、社員がいても種類ごとの番号で呼ぶ', () => {
    expect(nodeName(nodes[1], nodes, ctx({ '0,0': '田中' }))).toBe('サーバー-1');
    expect(nodeName(nodes[3], nodes, ctx())).toBe('スイッチ-1');
  });

  it('手で付けた名前があれば、それを使う', () => {
    const named = node('e', 'pc_basic', 1, 1, '受付');
    expect(nodeName(named, [named], ctx({ '1,1': '田中' }))).toBe('受付');
  });

  it('同じ種類でも品目が違えば、品目の名前で呼び、品目ごとに番号を振る', () => {
    const DEVICE: Record<string, string> = { router_basic: 'ルーター', router_sfp: 'SFP対応ルーター', edge_router: 'エッジルーター' };
    const withDevice: NameContext = { ...ctx(), categoryLabel: () => 'ルーター', deviceLabel: (d) => DEVICE[d] ?? d };
    const routers = [node('r1', 'router_basic'), node('r2', 'router_sfp'), node('r3', 'edge_router'), node('r4', 'edge_router')];
    expect(nodeName(routers[0], routers, withDevice)).toBe('ルーター1');
    expect(nodeName(routers[1], routers, withDevice)).toBe('SFP対応ルーター1');
    expect(nodeName(routers[2], routers, withDevice)).toBe('エッジルーター1');
    expect(nodeName(routers[3], routers, withDevice)).toBe('エッジルーター2');
  });

  it('名前を空にすると、既定の名前に戻る', () => {
    const renamed = renameNode(node('e', 'pc_basic', 0, 0, '受付'), '  ');
    expect(renamed.name).toBeUndefined();
    expect(nodeName(renamed, [renamed], ctx())).toBe('PC-1');
  });

  it('名前は前後の空白を除き、24文字までにする', () => {
    expect(renameNode(node('e', 'pc_basic'), '  共有 ').name).toBe('共有');
    expect(renameNode(node('e', 'pc_basic'), 'あ'.repeat(30)).name).toHaveLength(24);
  });
});

describe('サーバーの名前（動いているサービスで決める）', () => {
  it('サービスがなければ「サーバー」、1つなら役割の名前、2つ以上なら複合サーバー', () => {
    const none = served('a', []);
    expect(nodeName(none, [none], ctx())).toBe('サーバー-1');
    const web = served('b', [WEB]);
    expect(nodeName(web, [web], ctx())).toBe('Webサーバー-1');
    const dns = served('c', [DNS]);
    expect(nodeName(dns, [dns], ctx())).toBe('DNSサーバー-1');
    const radius = served('d', [{ protocol: 'radius' }]);
    expect(nodeName(radius, [radius], ctx())).toBe('RADIUSサーバー-1');
    const both = served('e', [WEB, DNS]);
    expect(nodeName(both, [both], ctx())).toBe('複合サーバー-1');
  });

  it('サービスを外すと、名前も既定の名前に戻る', () => {
    const before = served('a', [WEB]);
    expect(nodeName(before, [before], ctx())).toBe('Webサーバー-1');
    const after = served('a', []);
    expect(nodeName(after, [after], ctx())).toBe('サーバー-1');
  });

  it('同じ名前のサーバーの中で、並び順に番号を振る（違う名前は別に数える）', () => {
    const servers = [served('a', [WEB]), served('b', [DNS]), served('c', [WEB])];
    expect(nodeName(servers[0], servers, ctx())).toBe('Webサーバー-1');
    expect(nodeName(servers[1], servers, ctx())).toBe('DNSサーバー-1');
    expect(nodeName(servers[2], servers, ctx())).toBe('Webサーバー-2');
  });

  it('手で付けた名前があれば、サービスより優先する', () => {
    const named = { ...served('a', [WEB]), name: '受付' };
    expect(nodeName(named, [named], ctx())).toBe('受付');
  });
});
