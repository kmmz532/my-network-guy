import { describe, expect, it } from 'vitest';
import { cables, devices, lessons } from 'virtual:game-data';
import ja from '../assets/lang/ja_jp.json';
import type { Lesson } from '../data/schema';
import type { EngineData } from '../network/types';
import { lessonGoalResults, lessonLinks, lessonNodes, lessonSegments } from './lesson';
import { segmentConfigOf, segmentsOf } from '../network/segments';
import { solutions } from '../__golden__/solutions';

const engine: EngineData = {
  categoryOf: (device) => devices[device as keyof typeof devices]?.category ?? 'unknown',
  maxLengthOf: (cable) => cables[cable as keyof typeof cables]?.maxLengthTiles ?? 0,
};

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
        n.uid === 'SRV' ? { ...n, dhcpPools: [pool] } : n.uid === 'R1' && helper ? { ...n, interfaces: n.interfaces.map((i) => (i.port === 1 ? { ...i, helper: '10.0.1.2' } : i)) } : n,
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
      lessonNodes(l).map((n) => (n.uid === 'AP1' ? { ...n, wireless: { ...n.wireless, security } } : n));
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
      n.uid === 'R1' ? { ...n, napt: true, interfaces: n.interfaces.map((i) => ({ ...i, nat: i.port === 0 ? ('outside' as const) : ('inside' as const) })) } : n,
    );
    expect(lessonGoalResults(l.goals, solved, links, engine)).toEqual([true]);
  });
});
