// 演習の問いの判定: 正解が構成から求まり、候補に正解が含まれ、構成を変えると正解が変わる
import { describe, expect, it } from 'vitest';
import { lessons } from 'virtual:game-data';
import balanceJson from '../assets/data/balance.json';
import type { Balance, Change, Drill, InspectAsk, Question } from '../data/schema';
import { solutions } from '../__golden__/solutions';
import type { EngineData } from '../network/types';
import { applySetup, diagnoseChoices, drillConfig, drillState, inspectAnswer, inspectChoices, judgeBuild, judgeDiagnose, judgeInspect, type DrillConfig } from './drill';
import type { Env } from './project';

const engine: EngineData = { wallAt: () => false, interferers: [] };
const env: Env = { balance: balanceJson as unknown as Balance, engine };

// 演習の構成は教材の構成を流用する（問いと setup だけをここで組む）
const drillOf = (lessonId: string, questions: Question[], setup?: Drill['setup']): Drill => {
  const l = lessons.find((x) => x.id === lessonId);
  if (!l) throw new Error(`教材 ${lessonId} がない`);
  return { id: `drill_${lessonId}`, topic: l.topic, order: 1, size: l.size, placed: l.placed, links: l.links, questions, setup };
};
const solved = (lessonId: string, drill: Drill): DrillConfig => {
  const c = drillConfig(drill);
  return { nodes: solutions[lessonId](c.nodes), links: c.links };
};
const ifaceId = (c: DrillConfig, uid: string, port: number): string => {
  const id = c.nodes.find((n) => n.uid === uid)?.interfaces.find((i) => i.port === port)?.id;
  if (!id) throw new Error(`口 ${uid}:${port} がない`);
  return id;
};
const ospf = (uid: string, id: string, key: 'cost' | 'priority', value: number): Change => ({ kind: 'config', uid, change: { kind: 'ospf', change: { op: 'iface', id, key, value } } });

// 問いの前後で、正解・候補・判定を確かめる
const check = (drill: Drill, base: DrillConfig, ask: InspectAsk, change: Change, before: string, after: string): void => {
  const q: Question = { kind: 'inspect', id: 'q2', ask };
  const withSetup: Drill = { ...drill, questions: [...drill.questions, q], setup: [{ before: 'q2', change: [change] }] };
  const s0 = drillState(base, engine);
  expect(inspectAnswer(s0, ask)).toBe(before);
  expect(inspectChoices(s0, ask)).toContain(before);
  expect(judgeInspect(s0, ask, before)).toBe(true);
  expect(judgeInspect(s0, ask, `${before}x`)).toBe(false);
  const changed = applySetup(withSetup, 'q2', base, env);
  const s1 = drillState(changed, engine);
  expect(inspectAnswer(s1, ask)).toBe(after);
  expect(inspectChoices(s1, ask)).toContain(after);
};

describe('演習: 調べて答える問い', () => {
  const sites = drillOf('ospf_three_sites', []);
  const sitesBase = solved('ospf_three_sites', sites);
  const costUp = ospf('R1', ifaceId(sitesBase, 'R1', 2), 'cost', 100);

  it('next_hop: 経路表の次のホップ。R1 と R3 の間のコストを上げると R2 に変わる', () => {
    check(sites, sitesBase, { what: 'next_hop', node: 'R1', prefix: '10.0.3.0/24' }, costUp, '10.0.31.1', '10.0.12.2');
  });

  it('route_source: 経路の出どころ。静的経路を足すと O から S に変わり、直結は C', () => {
    const add: Change = { kind: 'config', uid: 'R1', change: { kind: 'addRoute', route: { dest: '10.0.2.0', prefix: 24, nextHop: '10.0.12.2' } } };
    check(sites, sitesBase, { what: 'route_source', node: 'R1', prefix: '10.0.2.0/24' }, add, 'O', 'S');
    expect(inspectAnswer(drillState(sitesBase, engine), { what: 'route_source', node: 'R1', prefix: '10.0.1.0/24' })).toBe('C');
  });

  it('ospf_dr: 優先度の高いルーターが DR になる。R1 の優先度を上げると R1 に変わる', () => {
    const dr = drillOf('ospf_dr', []);
    const base = solved('ospf_dr', dr);
    check(dr, base, { what: 'ospf_dr', segment: '10.0.10.0/24' }, ospf('R1', ifaceId(base, 'R1', 1), 'priority', 200), 'R3', 'R1');
  });

  it('stp_root: ブリッジ優先度の低いスイッチがルート。SW3 の優先度を下げると SW3 に変わる', () => {
    const stp = drillOf('stp_triangle', []);
    const base = drillConfig(stp);
    const lower: Change = { kind: 'config', uid: 'SW3', change: { kind: 'stp', change: { op: 'priority', value: 4096 } } };
    check(stp, base, { what: 'stp_root' }, lower, 'SW1', 'SW3');
  });

  it('vrrp_master: 優先度の高いルーターがマスター。R1 の優先度を下げると R2 に変わる', () => {
    const vrrp = drillOf('vrrp_pair', []);
    const base = solved('vrrp_pair', vrrp);
    const down: Change = { kind: 'config', uid: 'R1', change: { kind: 'vrrp', change: { op: 'priority', id: ifaceId(base, 'R1', 0), vrid: 1, value: 90 } } };
    check(vrrp, base, { what: 'vrrp_master', vrid: 1 }, down, 'R1', 'R2');
  });

  it('bgp_best: 選ばれた AS パス。同じ長さのときは隣接のアドレスの小さい側。R3 の localPref を上げると変わる', () => {
    const router = (ref: string, ifaces: { port: number; ip: string }[]) => ({ ref, device: 'edge_router', x: 0, y: 0, locked: false, config: { interfaces: ifaces.map((i) => ({ ...i, prefix: 24 })), gateway: null, services: [], locked: false } });
    const drill: Drill = {
      id: 'drill_bgp',
      topic: 'routing',
      order: 1,
      size: { w: 4, h: 4 },
      placed: [router('R1', [{ port: 1, ip: '10.0.12.1' }, { port: 2, ip: '10.0.13.1' }]), router('R2', [{ port: 0, ip: '10.0.12.2' }, { port: 1, ip: '10.9.0.1' }]), router('R3', [{ port: 0, ip: '10.0.13.2' }, { port: 1, ip: '10.9.0.2' }])],
      links: [
        { cable: 'utp_cat5e', a: { ref: 'R1', port: 1 }, b: { ref: 'R2', port: 0 } },
        { cable: 'utp_cat5e', a: { ref: 'R1', port: 2 }, b: { ref: 'R3', port: 0 } },
      ],
      questions: [],
    };
    const bgp = (asn: number, neighbors: { ip: string; remoteAs: number }[], networks: { dest: string; prefix: number }[]) => ({ bgp: { asn, neighbors, networks } });
    const comps: Record<string, ReturnType<typeof bgp>> = {
      R1: bgp(100, [{ ip: '10.0.12.2', remoteAs: 200 }, { ip: '10.0.13.2', remoteAs: 300 }], []),
      R2: bgp(200, [{ ip: '10.0.12.1', remoteAs: 100 }], [{ dest: '10.9.0.0', prefix: 24 }]),
      R3: bgp(300, [{ ip: '10.0.13.1', remoteAs: 100 }], [{ dest: '10.9.0.0', prefix: 24 }]),
    };
    const c = drillConfig(drill);
    const base: DrillConfig = { nodes: c.nodes.map((n) => ({ ...n, components: comps[n.uid] })), links: c.links };
    const prefer: Change = { kind: 'config', uid: 'R1', change: { kind: 'bgp', change: { op: 'attr', ip: '10.0.13.2', key: 'localPref', value: 200 } } };
    check(drill, base, { what: 'bgp_best', node: 'R1', prefix: '10.9.0.0/24' }, prefer, '200', '300');
  });

  it('frame_field: ホップのフレームの値。R1 と R3 の間のコストを上げると、2ホップ目の送信元 MAC が変わる', () => {
    const ask: InspectAsk = { what: 'frame_field', from: 'PC1', to: 'PC3', hop: 1, field: 'srcMac' };
    const s0 = drillState(sitesBase, engine);
    const before = inspectAnswer(s0, ask);
    expect(inspectChoices(s0, ask)).toContain(before);
    const drill = drillOf('ospf_three_sites', [{ kind: 'inspect', id: 'q2', ask }], [{ before: 'q2', change: [costUp] }]);
    const after = inspectAnswer(drillState(applySetup(drill, 'q2', sitesBase, env), engine), ask);
    expect(after).not.toBe(before);
    expect(inspectAnswer(s0, { ...ask, field: 'ttl', hop: 0 })).toBe('64');
  });
});

describe('演習: 原因を選ぶ問いと設定する問い', () => {
  const drill = drillOf('ospf_three_sites', []);
  const broken = drillConfig(drill);
  const q: Extract<Question, { kind: 'diagnose' }> = { kind: 'diagnose', id: 'd1', from: 'PC1', to: 'PC3', traffic: { kind: 'ping' } };

  it('diagnose: 失敗の機器と理由の両方が合うときだけ合格する', () => {
    const s = drillState(broken, engine);
    expect(judgeDiagnose(s, q, { node: 'R1', reason: 'route.none' })).toBe(true);
    expect(judgeDiagnose(s, q, { node: 'R2', reason: 'route.none' })).toBe(false);
    expect(judgeDiagnose(s, q, { node: 'R1', reason: 'gateway.unset' })).toBe(false);
    const choices = diagnoseChoices(s);
    expect(choices.nodes).toContain('R1');
    expect(choices.reasons).toContain('route.none');
  });

  it('diagnose: 構成を変えると失敗の機器が変わり、直ると原因がなく例外になる', () => {
    const off: Change = { kind: 'config', uid: 'R1', change: { kind: 'power', on: false } };
    const withSetup: Drill = { ...drill, questions: [q], setup: [{ before: 'd1', change: [off] }] };
    const s = drillState(applySetup(withSetup, 'd1', broken, env), engine);
    expect(judgeDiagnose(s, q, { node: 'R1', reason: 'route.none' })).toBe(false);
    expect(() => judgeDiagnose(drillState(solved('ospf_three_sites', drill), engine), q, { node: 'R1', reason: 'route.none' })).toThrow();
  });

  it('build: 達成条件を満たすと合格し、設定を戻すと不合格になる', () => {
    const l = lessons.find((x) => x.id === 'ospf_three_sites');
    if (!l) throw new Error('教材がない');
    const build: Extract<Question, { kind: 'build' }> = { kind: 'build', id: 'b1', goals: l.goals };
    expect(judgeBuild(build, broken, engine)).toBe(false);
    expect(judgeBuild(build, solved('ospf_three_sites', drill), engine)).toBe(true);
  });

  it('setup: 問いにない id・失敗する変更は例外で止まる', () => {
    expect(() => applySetup(drill, 'none', broken, env)).toThrow();
    const bad: Change = { kind: 'config', uid: 'R1', change: { kind: 'stp', change: { op: 'priority', value: 4096 } } };
    const withBad: Drill = { ...drill, questions: [q], setup: [{ before: 'd1', change: [bad] }] };
    expect(() => applySetup(withBad, 'd1', broken, env)).toThrow();
  });
});
