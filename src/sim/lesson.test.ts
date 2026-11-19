import { describe, expect, it } from 'vitest';
import { lessons } from 'virtual:game-data';
import { deviceCategory } from '../registry/query';
import ja from '../assets/lang/ja_jp.json';
import type { Balance, Lesson, Question } from '../data/schema';
import balanceJson from '../assets/data/balance.json';
import { applySetup, drillConfig, drillState, judgeBuild, judgeDiagnose } from './drill';
import type { Env } from './project';
import type { EngineData } from '../network/types';
import { lessonGoalResults, lessonLinks, lessonNodes, lessonPlans } from './lesson';
import { planFor } from '../network/segments';
import { controlSequence } from '../network/public';
import { analyze } from '../network/engine/analyze';
import { ospfNeighborsOf } from '../network/query/ospfNeighbors';
import type { Network } from '../network/types';

const domainsOf = (net: Network, data: EngineData) => analyze(net, data).l2.planDomains;

import { solutions } from '../__golden__/solutions';

const engine: EngineData = { wallAt: () => false, interferers: [] };
const env: Env = { balance: balanceJson as unknown as Balance, engine };

const lesson = (id: string): Lesson => {
  const found = lessons.find((l) => l.id === id);
  if (!found) throw new Error(`教材 ${id} がない`);
  return found;
};

// 正解の設定は src/__golden__/solutions.ts（挙動の記録の試験と共通）

describe('教材（学習モード）', () => {
  it('すべての教材に、題名・依頼文・案内の文言がある', () => {
    for (const l of lessons) {
      expect(ja).toHaveProperty([`lesson.${l.id}.title`]);
      expect(ja).toHaveProperty([`lesson.${l.id}.brief`]);
      l.guide.forEach((_, i) => expect(ja).toHaveProperty([`lesson.${l.id}.step.${i + 1}`]));
    }
  });

  it('OSPF の3拠点: 初めは達成条件を満たさず、OSPF を設定すると満たす', () => {
    const l = lesson('ospf_three_sites');
    const links = lessonLinks(l);
    expect(lessonGoalResults(l.goals, lessonNodes(l), links, engine)).toEqual([false, false]);
    expect(lessonGoalResults(l.goals, solutions[l.id](lessonNodes(l)), links, engine)).toEqual([true, true]);
  });

  it('OSPF のエリア: 初めは届かず、エリアを分けて ABR を置くと届く。R3 を両方エリア 2 にすると、エリア 0 から切り離されて届かない', () => {
    const l = lesson('ospf_areas');
    const links = lessonLinks(l);
    expect(lessonGoalResults(l.goals, lessonNodes(l), links, engine)).toEqual([false, false]);
    expect(lessonGoalResults(l.goals, solutions[l.id](lessonNodes(l)), links, engine)).toEqual([true, true]);
    const detached = solutions[l.id](lessonNodes(l)).map((n) =>
      n.uid === 'R3' ? { ...n, interfaces: n.interfaces.map((i) => (i.port === 0 ? { ...i, ospf: { area: 2 } } : i)) } : n,
    );
    expect(lessonGoalResults(l.goals, detached, links, engine)[0]).toBe(false);
  });

  it('OSPF の DR: 初めは届かず、3台に OSPF を設定すると届く。R1 の優先度を上げると、DR が R1 に替わる', () => {
    const l = lesson('ospf_dr');
    const links = lessonLinks(l);
    expect(lessonGoalResults(l.goals, lessonNodes(l), links, engine)).toEqual([false, false]);
    const solved = solutions[l.id](lessonNodes(l));
    expect(lessonGoalResults(l.goals, solved, links, engine)).toEqual([true, true]);
    const drOf = (nodes: typeof solved) =>
      ospfNeighborsOf(analyze({ nodes, links, plans: {} }, engine), 'R2').find((nb) => nb.state === 'FULL/DR')?.uid;
    expect(drOf(solved)).toBe('R3');
    const boosted = solved.map((n) =>
      n.uid === 'R1' ? { ...n, interfaces: n.interfaces.map((i) => (i.port === 1 ? { ...i, ospf: { area: 0, priority: 200 } } : i)) } : n,
    );
    expect(drOf(boosted)).toBe('R1');
  });

  it('サブネットの教材: 初めは同じスイッチでも届かず、同じネットワークに直すと4台が通じる。別のネットワークのアドレスに戻すと、また届かなくなる', () => {
    const l = lesson('subnet_basics');
    const links = lessonLinks(l);
    expect(lessonGoalResults(l.goals, lessonNodes(l), links, engine)).toEqual([false, false]);
    const solved = solutions[l.id](lessonNodes(l));
    expect(lessonGoalResults(l.goals, solved, links, engine)).toEqual([true, true]);
    const moved = solved.map((n) => (n.uid === 'PC4' ? { ...n, interfaces: n.interfaces.map((i) => ({ ...i, ip: '10.0.2.11' })) } : n));
    expect(lessonGoalResults(l.goals, moved, links, engine)[0]).toBe(false);
  });

  it('ワイルドカードの教材: 初めは届かず、R1 と R2 の口を参加させると届く。R1 の1つの口が参加から外れると、その先へ届かない', () => {
    const l = lesson('wildcard_mask');
    const links = lessonLinks(l);
    expect(lessonGoalResults(l.goals, lessonNodes(l), links, engine)).toEqual([false, false]);
    const solved = solutions[l.id](lessonNodes(l));
    expect(lessonGoalResults(l.goals, solved, links, engine)).toEqual([true, true]);
    const missed = solved.map((n) => (n.uid === 'R1' ? { ...n, interfaces: n.interfaces.map((i) => (i.port === 1 ? { ...i, ospf: undefined } : i)) } : n));
    expect(lessonGoalResults(l.goals, missed, links, engine)[0]).toBe(false);
  });

  it('RIP の3拠点: 初めは達成条件を満たさず、RIP を設定すると満たす', () => {
    const l = lesson('rip_three_sites');
    const links = lessonLinks(l);
    expect(lessonGoalResults(l.goals, lessonNodes(l), links, engine)).toEqual([false, false]);
    expect(lessonGoalResults(l.goals, solutions[l.id](lessonNodes(l)), links, engine)).toEqual([true, true]);
  });

  it('RIP と OSPF の教材: RIP では近道（1ホップ）を通り1G の条件を満たさない。OSPF でも基準の帯域が既定のままだと近道のままで、基準を 1000 にすると遠回りを選び両方満たす', () => {
    const l = lesson('rip_vs_ospf');
    const links = lessonLinks(l);
    const on = (proto: 'rip' | 'ospf') => (nodes: typeof solved) =>
      nodes.map((n) => (['R1', 'R2', 'R3'].includes(n.uid) ? { ...n, interfaces: n.interfaces.map((i) => (proto === 'rip' ? { ...i, rip: true } : { ...i, ospf: { area: 0 } })) } : n));
    const solved = solutions[l.id](lessonNodes(l));
    expect(lessonGoalResults(l.goals, lessonNodes(l), links, engine)).toEqual([false, false]);
    expect(lessonGoalResults(l.goals, on('rip')(lessonNodes(l)), links, engine)).toEqual([true, false]);
    expect(lessonGoalResults(l.goals, on('ospf')(lessonNodes(l)), links, engine)).toEqual([true, false]);
    expect(lessonGoalResults(l.goals, solved, links, engine)).toEqual([true, true]);
  });

  it('ロードバランサーの教材: 置いた直後は負荷分散の達成条件を満たさず、仮想サーバーを設定すると2条件とも満たす', () => {
    const l = lesson('lb_basics');
    const links = lessonLinks(l);
    expect(lessonGoalResults(l.goals, lessonNodes(l), links, engine)[0]).toBe(false);
    expect(lessonGoalResults(l.goals, solutions[l.id](lessonNodes(l)), links, engine)).toEqual([true, true]);
  });


  it('ロードバランサーの教材の発展の問い: ヘルスチェックなしで WEB2 が止まると、PC1 からの HTTP は LB で止まる', () => {
    const l = lessons.find((x) => x.id === 'lb_basics');
    if (!l?.followUps || !l.followUpSetup) throw new Error('発展の問いがない');
    const q = l.followUps[0] as Extract<Question, { kind: 'diagnose' }>;
    const base = drillConfig(l);
    const set = { id: l.id, questions: l.followUps, setup: l.followUpSetup };
    const s = drillState(applySetup(set, 'f1', { nodes: solutions[l.id](base.nodes), links: base.links }, env), engine);
    expect(judgeDiagnose(s, q, { node: 'LB', reason: 'lb.member_down' })).toBe(true);
  });

  it('キャッシュ DNS と権威 DNS の教材: 置いた直後は名前で届かず、転送先とネームサーバーを設定すると2条件とも満たす', () => {
    const l = lesson('dns_cache_auth');
    const links = lessonLinks(l);
    expect(lessonGoalResults(l.goals, lessonNodes(l), links, engine)).toEqual([false, false]);
    expect(lessonGoalResults(l.goals, solutions[l.id](lessonNodes(l)), links, engine)).toEqual([true, true]);
  });

  it('キャッシュ DNS と権威 DNS の教材の発展の問い: 権威 DNS が止まると、キャッシュの問い合わせが届かない', () => {
    const l = lessons.find((x) => x.id === 'dns_cache_auth');
    if (!l?.followUps || !l.followUpSetup) throw new Error('発展の問いがない');
    const q = l.followUps[0] as Extract<Question, { kind: 'diagnose' }>;
    const base = drillConfig(l);
    const set = { id: l.id, questions: l.followUps, setup: l.followUpSetup };
    const s = drillState(applySetup(set, 'f1', { nodes: solutions[l.id](base.nodes), links: base.links }, env), engine);
    expect(judgeDiagnose(s, q, { node: 'R1', reason: 'ip.unreachable' })).toBe(true);
  });

  it('名前で引く HTTP の図には DNS の問い合わせが出て、PC1 から キャッシュ、キャッシュから権威へ流れる', () => {
    const l = lesson('dns_cache_auth');
    const state = analyze({ nodes: solutions[l.id](lessonNodes(l)), links: lessonLinks(l), plans: {} }, engine);
    const dns = controlSequence(state, { kind: 'http', from: 'PC1', to: 'WEB', port: 80, name: 'web.office.internal' }).filter((s) => s.proto === 'dns');
    expect(dns.slice(0, 2).map((s) => [s.from, s.to])).toEqual([['PC1', 'CACHE'], ['CACHE', 'AUTH']]);
  });

  it('拠点間の IPsec VPN の教材: 置いた直後は2条件とも満たさず、両方のトンネルを設定すると満たす', () => {
    const l = lesson('ipsec_vpn_two_sites');
    const links = lessonLinks(l);
    expect(lessonGoalResults(l.goals, lessonNodes(l), links, engine)).toEqual([false, false]);
    expect(lessonGoalResults(l.goals, solutions[l.id](lessonNodes(l)), links, engine)).toEqual([true, true]);
  });

  it('拠点間の IPsec VPN の発展の問い: 支社の鍵を変えると、HQ-PC から BR-PC への ping は鍵の不一致で止まる', () => {
    const l = lessons.find((x) => x.id === 'ipsec_vpn_two_sites');
    if (!l?.followUps || !l.followUpSetup) throw new Error('発展の問いがない');
    const q = l.followUps[0] as Extract<Question, { kind: 'diagnose' }>;
    const base = drillConfig(l);
    const set = { id: l.id, questions: l.followUps, setup: l.followUpSetup };
    const s = drillState(applySetup(set, 'f1', { nodes: solutions[l.id](base.nodes), links: base.links }, env), engine);
    expect(judgeDiagnose(s, q, { node: 'HQ_VPN', reason: 'vpn.psk_mismatch' })).toBe(true);
  });

  it('MTU の教材: 置いた直後は WAN の口の MTU が小さく DF 付きの ping が届かず、MTU を直すと届く。1500 の DF はシーケンス図で分割が必要の行になる', () => {
    const l = lesson('mtu_vpn');
    const links = lessonLinks(l);
    expect(lessonGoalResults(l.goals, lessonNodes(l), links, engine)).toEqual([false]);
    expect(lessonGoalResults(l.goals, solutions[l.id](lessonNodes(l)), links, engine)).toEqual([true]);
    const state = analyze({ nodes: solutions[l.id](lessonNodes(l)), links, plans: {} }, engine);
    const last = controlSequence(state, { kind: 'ping', from: 'HQ_PC', to: 'BR_PC', size: 1500, df: true }).at(-1);
    expect(last?.label).toBe('seq.icmp.fragNeeded');
    expect(last?.failure).toEqual({ reason: 'mtu.exceeded', node: 'HQ_VPN' });
  });

  it('MTU の発展の問い: HQ-VPN の WAN の口の MTU を 1400 にすると、HQ-VPN で MTU の超過になる', () => {
    const l = lessons.find((x) => x.id === 'mtu_vpn');
    if (!l?.followUps || !l.followUpSetup) throw new Error('発展の問いがない');
    const q = l.followUps[0] as Extract<Question, { kind: 'diagnose' }>;
    const base = drillConfig(l);
    const set = { id: l.id, questions: l.followUps, setup: l.followUpSetup };
    const s = drillState(applySetup(set, 'f1', { nodes: solutions[l.id](base.nodes), links: base.links }, env), engine);
    expect(judgeDiagnose(s, q, { node: 'HQ_VPN', reason: 'mtu.exceeded' })).toBe(true);
  });

  it('QoS の教材: 置いた直後は音声が削られ、信頼と priority-queue を設定すると削られずに届く。発展の問いは信頼を外した構成から始まり、戻すと合格', () => {
    const l = lesson('qos_voice');
    const links = lessonLinks(l);
    expect(lessonGoalResults(l.goals, lessonNodes(l), links, engine, l.flows)).toEqual([false]);
    const solved = solutions[l.id](lessonNodes(l));
    expect(lessonGoalResults(l.goals, solved, links, engine, l.flows)).toEqual([true]);
    if (!l.followUps || !l.followUpSetup) throw new Error('発展の問いがない');
    const q = l.followUps[0];
    if (q.kind !== 'build') throw new Error('発展の問いが設定する問いでない');
    const set = { id: l.id, questions: l.followUps, setup: l.followUpSetup };
    const broken = applySetup(set, 'f1', { nodes: solved, links }, env);
    expect(judgeBuild(q, broken, engine, l.flows)).toBe(false);
    expect(judgeBuild(q, { nodes: solved, links }, engine, l.flows)).toBe(true);
  });

  it('DNS の教材: 初めは外へ出られず、NAT を設定すると通る。ネームサーバーを向けると社内と外の名前が引ける', () => {
    const l = lesson('dns_intranet_names');
    const links = lessonLinks(l);
    expect(lessonGoalResults(l.goals, lessonNodes(l), links, engine)).toEqual([true, false, false, false]);
    const solved = solutions[l.id](lessonNodes(l));
    expect(lessonGoalResults(l.goals, solved, links, engine)).toEqual([true, true, true, true]);
  });

  it('教材の機器に、MAC アドレスの連番が置いた順に振られる', () => {
    const nodes = lessonNodes(lesson('ospf_three_sites'));
    expect(nodes.map((n) => n.macSerial)).toEqual(nodes.map((_, i) => i + 1));
  });

  it('2社の ISP と BGP: 初めは隣接がなく、BGP を設定すると両方の回線を使える', () => {
    const l = lesson('bgp_two_isps');
    const links = lessonLinks(l);
    expect(lessonGoalResults(l.goals, lessonNodes(l), links, engine)[0]).toBe(false);
    expect(lessonGoalResults(l.goals, solutions[l.id](lessonNodes(l)), links, engine)).toEqual([true, true]);
  });

  it('VLAN の2フロア: 初めは部署の間も通じ、VLAN とトランクの設定で分かれる。許可から VLAN 20 を外すと経理が止まる', () => {
    const l = lesson('vlan_two_floors');
    const links = lessonLinks(l);
    expect(lessonGoalResults(l.goals, lessonNodes(l), links, engine)).toEqual([true, true, false]);
    const ports = (access: [number, number][], trunkAllowed: number[]) => [
      ...access.map(([port, vlan]) => ({ port, mode: 'access' as const, vlan })),
      { port: 7, mode: 'trunk' as const, allowed: trunkAllowed },
    ];
    const solved = (allowed: number[]) =>
      lessonNodes(l).map((n) => (n.uid === 'SW1' || n.uid === 'SW2' ? { ...n, ports: ports([[0, 10], [1, 20]], allowed) } : n));
    expect(lessonGoalResults(l.goals, solved([10, 20]), links, engine)).toEqual([true, true, true]);
    expect(lessonGoalResults(l.goals, solved([10]), links, engine)).toEqual([true, false, true]);
  });
});

describe('教材を開いた直後の網の設定', () => {
  it('ルーターのある網には、開いた直後から設定（ケーブルの色）がある', () => {
    const l = lesson('ospf_three_sites');
    const nodes = lessonNodes(l);
    const links = lessonLinks(l);
    const segments = lessonPlans(nodes, links, engine);
    const byUid = new Map(nodes.map((n) => [n.uid, n]));
    const routerSegs = domainsOf({ nodes, links }, engine).filter((seg) =>
      seg.members.some((m) => deviceCategory(byUid.get(m.node)?.device ?? '') === 'router'),
    );
    expect(routerSegs.length).toBeGreaterThan(0);
    for (const seg of routerSegs) expect(planFor(seg, byUid, segments)).toBeDefined();
  });

  it('VRRP の教材: 初めは届かず、両側に VRRP を設定すると、どちらのルーターを止めても届く', () => {
    const l = lesson('vrrp_pair');
    const links = lessonLinks(l);
    expect(lessonGoalResults(l.goals, lessonNodes(l), links, engine)).toEqual([false, false]);
    expect(lessonGoalResults(l.goals, solutions[l.id](lessonNodes(l)), links, engine)).toEqual([true, true]);
  });

  it('スパニングツリーの教材: 初めは SW1 がルート。SW2 の優先度を下げると SW2 がルートになる', () => {
    const l = lesson('stp_triangle');
    const links = lessonLinks(l);
    expect(lessonGoalResults(l.goals, lessonNodes(l), links, engine)).toEqual([true, false]);
    expect(lessonGoalResults(l.goals, solutions[l.id](lessonNodes(l)), links, engine)).toEqual([true, true]);
  });

  it('リンクアグリゲーションの教材: 初めは通じるがまとまっておらず、両端でまとめると合格する。両端 passive ではまとまらない', () => {
    const l = lesson('lag_uplink');
    const links = lessonLinks(l);
    expect(lessonGoalResults(l.goals, lessonNodes(l), links, engine)).toEqual([true, false]);
    const withMode = (a: 'active' | 'passive', b: 'active' | 'passive') =>
      lessonNodes(l).map((n) =>
        n.uid === 'SW1' || n.uid === 'SW2'
          ? { ...n, ports: [0, 1].map((port) => ({ port, mode: 'access' as const, channelGroup: 1, lacp: n.uid === 'SW1' ? a : b })) }
          : n,
      );
    expect(lessonGoalResults(l.goals, withMode('active', 'active'), links, engine)).toEqual([true, true]);
    expect(lessonGoalResults(l.goals, withMode('passive', 'passive'), links, engine)).toEqual([true, false]);
  });

  it('DHCP の教材: 初めは受け取れず、サーバーのプールとルーターのリレーを設定すると、届く。リレーを外すと受け取れない', () => {
    const l = lesson('dhcp_relay');
    const links = lessonLinks(l);
    expect(lessonGoalResults(l.goals, lessonNodes(l), links, engine)).toEqual([false, false]);
    const pool = { network: '192.168.1.0', prefix: 24, start: '192.168.1.100', end: '192.168.1.150', gateway: '192.168.1.1' };
    const solved = (helper: boolean) =>
      lessonNodes(l).map((n) =>
        n.uid === 'SRV' ? { ...n, components: { dhcpServer: [pool] } } : n.uid === 'R1' && helper ? { ...n, interfaces: n.interfaces.map((i) => (i.port === 1 ? { ...i, helper: '10.0.1.2' } : i)) } : n,
      );
    expect(lessonGoalResults(l.goals, solved(true), links, engine)).toEqual([true, true]);
    expect(lessonGoalResults(l.goals, solved(false), links, engine)).toEqual([false, false]);
  });

  it('OSPF の入門の教材: 初めは届かず、両側の口を OSPF に参加させると届く（静的経路は使わない）', () => {
    const l = lesson('ospf_intro');
    const links = lessonLinks(l);
    expect(lessonGoalResults(l.goals, lessonNodes(l), links, engine)).toEqual([false, false]);
    const solved = lessonNodes(l).map((n) => (n.uid === 'R1' || n.uid === 'R2' ? { ...n, interfaces: n.interfaces.map((i) => ({ ...i, ospf: { area: 0 } })) } : n));
    expect(lessonGoalResults(l.goals, solved, links, engine)).toEqual([true, true]);
  });

  it('無線の暗号化の教材: WEP は全員つながるが安全でない。WPA3 のみでは古い端末が外れ、WPA2 にすると全員つながり合格する', () => {
    const l = lesson('wifi_security');
    const links = lessonLinks(l);
    const withSecurity = (security: 'wep' | 'wpa3' | 'wpa2wpa3' | 'wpa2') =>
      lessonNodes(l).map((n) => (n.uid === 'AP1' ? { ...n, components: { ...n.components, wireless: { ...n.components?.wireless, security } } } : n));
    expect(lessonGoalResults(l.goals, lessonNodes(l), links, engine)).toEqual([true, false]);
    expect(lessonGoalResults(l.goals, withSecurity('wpa3'), links, engine)).toEqual([false, true]);
    expect(lessonGoalResults(l.goals, withSecurity('wpa2wpa3'), links, engine)).toEqual([true, false]);
    expect(lessonGoalResults(l.goals, withSecurity('wpa2'), links, engine)).toEqual([true, true]);
  });

  it('NAPT の教材: 初めは外へ届かず、外の口・内側の口・NAPT を設定すると届く', () => {
    const l = lesson('napt_office');
    const links = lessonLinks(l);
    expect(lessonGoalResults(l.goals, lessonNodes(l), links, engine)).toEqual([false]);
    const solved = lessonNodes(l).map((n) =>
      n.uid === 'R1' ? { ...n, components: { nat: { napt: true } }, interfaces: n.interfaces.map((i) => ({ ...i, nat: i.port === 0 ? ('outside' as const) : ('inside' as const) })) } : n,
    );
    expect(lessonGoalResults(l.goals, solved, links, engine)).toEqual([true]);
  });

  it('NAPT とファイアウォールの教材: 規則を変換の前の社内のアドレスで書くと届き、変換の後のアドレスで書くと届かない', () => {
    const l = lesson('nat_firewall');
    const links = lessonLinks(l);
    const withRule = (src: string) =>
      lessonNodes(l).map((n) =>
        n.uid === 'FW1'
          ? { ...n, components: { nat: { napt: true }, firewall: [{ src, dst: 'any', service: 'any' as const }] }, interfaces: n.interfaces.map((i) => ({ ...i, nat: i.port === 0 ? ('outside' as const) : ('inside' as const) })) }
          : n,
      );
    expect(lessonGoalResults(l.goals, lessonNodes(l), links, engine)).toEqual([false]);
    expect(lessonGoalResults(l.goals, withRule('198.51.100.2/32'), links, engine)).toEqual([false]);
    expect(lessonGoalResults(l.goals, withRule('192.168.1.0/24'), links, engine)).toEqual([true]);
  });
});
