import { describe, expect, it } from 'vitest';
import { cables, devices, lessons } from 'virtual:game-data';
import ja from '../assets/lang/ja_jp.json';
import type { Lesson } from '../data/schema';
import type { EngineData, NetNode } from '../network/types';
import { lessonGoalResults, lessonLinks, lessonNodes, lessonSegments } from './lesson';
import { segmentConfigOf, segmentsOf } from '../network/segments';

const engine: EngineData = {
  categoryOf: (device) => devices[device as keyof typeof devices]?.category ?? 'unknown',
  maxLengthOf: (cable) => cables[cable as keyof typeof cables]?.maxLengthTiles ?? 0,
};

const lesson = (id: string): Lesson => {
  const found = lessons.find((l) => l.id === id);
  if (!found) throw new Error(`教材 ${id} がない`);
  return found;
};

// 正解の設定（教材のデータには入れない）。ルーターのすべての口を、エリア 0 の OSPF に参加させる
const withOspf = (nodes: NetNode[]): NetNode[] =>
  nodes.map((n) => (engine.categoryOf(n.device) === 'router' ? { ...n, interfaces: n.interfaces.map((i) => ({ ...i, ospf: { area: 0 } })) } : n));

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
    expect(lessonGoalResults(l.goals, withOspf(lessonNodes(l)), links, engine)).toEqual([true, true]);
  });

  it('教材の機器に、MAC アドレスの連番が置いた順に振られる', () => {
    const nodes = lessonNodes(lesson('ospf_three_sites'));
    expect(nodes.map((n) => n.macSerial)).toEqual(nodes.map((_, i) => i + 1));
  });

  it('2社の ISP と BGP: 初めは隣接がなく、BGP を設定すると両方の回線を使える', () => {
    const l = lesson('bgp_two_isps');
    const links = lessonLinks(l);
    expect(lessonGoalResults(l.goals, lessonNodes(l), links, engine)[0]).toBe(false);
    const solved = lessonNodes(l).map((n) =>
      n.uid === 'R1' ? { ...n, bgp: { asn: 64512, neighbors: [{ ip: '198.51.100.1', remoteAs: 65001 }, { ip: '203.0.113.1', remoteAs: 65002 }], networks: [] } } : n,
    );
    expect(lessonGoalResults(l.goals, solved, links, engine)).toEqual([true, true]);
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
    const segments = lessonSegments(nodes, links, engine);
    const byUid = new Map(nodes.map((n) => [n.uid, n]));
    const routerSegs = segmentsOf({ nodes, links }, engine).filter((seg) =>
      seg.members.some((m) => engine.categoryOf(byUid.get(m.node)?.device ?? '') === 'router'),
    );
    expect(routerSegs.length).toBeGreaterThan(0);
    for (const seg of routerSegs) expect(segmentConfigOf(seg, byUid, segments)).toBeDefined();
  });

  it('VRRP の教材: 初めは届かず、両側に VRRP を設定すると、どちらのルーターを止めても届く', () => {
    const l = lesson('vrrp_pair');
    const links = lessonLinks(l);
    expect(lessonGoalResults(l.goals, lessonNodes(l), links, engine)).toEqual([false, false]);
    const group = (vrid: number, ip: string, priority: number) => [{ vrid, ip, priority, preempt: true }];
    const solved = lessonNodes(l).map((n) =>
      n.uid === 'R1' || n.uid === 'R2'
        ? { ...n, interfaces: n.interfaces.map((i) => ({ ...i, vrrp: i.port === 0 ? group(1, '192.168.1.254', n.uid === 'R1' ? 110 : 100) : group(2, '10.0.9.254', n.uid === 'R1' ? 110 : 100) })) }
        : n,
    );
    expect(lessonGoalResults(l.goals, solved, links, engine)).toEqual([true, true]);
  });

  it('スパニングツリーの教材: 初めは SW1 がルート。SW2 の優先度を下げると SW2 がルートになる', () => {
    const l = lesson('stp_triangle');
    const links = lessonLinks(l);
    expect(lessonGoalResults(l.goals, lessonNodes(l), links, engine)).toEqual([true, false]);
    const solved = lessonNodes(l).map((n) => (n.uid === 'SW2' ? { ...n, stpPriority: 4096 } : n));
    expect(lessonGoalResults(l.goals, solved, links, engine)).toEqual([true, true]);
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
        n.uid === 'SRV' ? { ...n, dhcpPools: [pool] } : n.uid === 'R1' && helper ? { ...n, interfaces: n.interfaces.map((i) => (i.port === 1 ? { ...i, helper: '10.0.1.2' } : i)) } : n,
      );
    expect(lessonGoalResults(l.goals, solved(true), links, engine)).toEqual([true, true]);
    expect(lessonGoalResults(l.goals, solved(false), links, engine)).toEqual([false, false]);
  });
});
