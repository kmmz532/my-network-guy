// 演習の進行: 誤答2回で正解が出る、正解で次へ進む、最後で完了。同梱の演習が、構成から正解を求められ、直すと合格になる
import { describe, expect, it } from 'vitest';
import { drills } from 'virtual:game-data';
import balanceJson from '../assets/data/balance.json';
import type { Balance, Change, Drill } from '../data/schema';
import type { EngineData } from '../network/types';
import { applySetup, diagnoseChoices, diagnoseReasonChoices, drillConfig, drillState, inspectAnswer, inspectChoices, judgeBuild } from './drill';
import { proceed, questionOf, startRun, submit, tested } from './drillRun';
import type { Env } from './project';

const engine: EngineData = { wallAt: () => false };
const env: Env = { balance: balanceJson as unknown as Balance, engine };

const drill: Drill = {
  id: 'd',
  topic: 'routing',
  order: 1,
  size: { w: 5, h: 5 },
  placed: [],
  links: [],
  questions: [
    { kind: 'inspect', id: 'a', ask: { what: 'stp_root' } },
    { kind: 'build', id: 'b', goals: [{ type: 'ping', from: 'X', to: 'Y' }] },
    { kind: 'diagnose', id: 'c', from: 'X', to: 'Y', traffic: { kind: 'ping' } },
  ],
};

describe('演習の進行', () => {
  it('調べる問いは、誤答の1回目は答える段のまま、2回目で正解を出し、進むと次の問いへ（build は直す段から始まる）', () => {
    let run = startRun(drill);
    expect(run).toEqual({ index: 0, stage: 'answer', misses: 0 });
    run = submit(drill, run, false);
    expect(run).toEqual({ index: 0, stage: 'answer', misses: 1 });
    run = submit(drill, run, false);
    expect(run).toEqual({ index: 0, stage: 'revealed', misses: 2 });
    run = proceed(drill, run);
    expect(run).toEqual({ index: 1, stage: 'fix', misses: 0 });
  });

  it('正解で次へ進み、テストが不合格の間は動かず、合格で次へ進む。原因を選ぶ問いは正解の後に直す段へ入る', () => {
    let run = submit(drill, startRun(drill), true);
    expect(questionOf(drill, run).id).toBe('b');
    expect(tested(drill, run, false)).toBe(run);
    run = tested(drill, run, true);
    expect(run).toEqual({ index: 2, stage: 'answer', misses: 0 });
    run = submit(drill, run, true);
    expect(run).toEqual({ index: 2, stage: 'fix', misses: 0 });
    run = tested(drill, run, true);
    expect(run.stage).toBe('done');
  });

  it('原因を選ぶ問いも、誤答2回で正解を出し、進むと直す段へ入る', () => {
    const run = proceed(drill, submit(drill, submit(drill, { index: 2, stage: 'answer', misses: 0 }, false), false));
    expect(run).toEqual({ index: 2, stage: 'fix', misses: 0 });
  });

  it('段に合わない操作は例外', () => {
    expect(() => proceed(drill, startRun(drill))).toThrow();
    expect(() => tested(drill, startRun(drill), true)).toThrow();
  });
});

describe('同梱の演習', () => {
  it.each(drills.map((d) => [d.id, d] as const))('%s: 問いの前の設定を当てると、正解が求まり候補に含まれ、設定する問いは直すと合格になる', (_id, d) => {
    let config = drillConfig(d);
    for (const q of d.questions) {
      config = applySetup(d, q.id, config, env);
      const state = drillState(config, engine);
      if (q.kind === 'inspect') {
        expect(inspectChoices(state, q.ask)).toContain(inspectAnswer(state, q.ask));
      } else if (q.kind === 'build') {
        expect(judgeBuild(q, config, engine)).toBe(false);
      } else {
        expect(diagnoseReasonChoices(state, q).length).toBeGreaterThan(0);
        expect(diagnoseChoices(state).nodes.length).toBeGreaterThan(0);
      }
    }
  });

  it('static_route_basics: R3 に戻りの経路を足すと、設定する問いが合格になる', () => {
    const d = drills.find((x) => x.id === 'static_route_basics');
    if (!d) throw new Error('演習 static_route_basics がない');
    const q = d.questions[1];
    if (q.kind !== 'build') throw new Error('2 問目が設定する問いでない');
    const before = applySetup(d, 'q1', drillConfig(d), env);
    expect(judgeBuild(q, before, engine)).toBe(false);
    const after = applySetup({ ...d, setup: [{ before: 'q2', change: [{ kind: 'config', uid: 'R3', change: { kind: 'addRoute', route: { dest: '10.0.1.0', prefix: 24, nextHop: '10.0.23.1' } } }] }] }, 'q2', before, env);
    expect(judgeBuild(q, after, engine)).toBe(true);
  });

  it('po_routed_drill: SW1 と SW2 の Po1 に同じネットワークの IP を付けると、設定する問いが合格になる', () => {
    const d = drills.find((x) => x.id === 'po_routed_drill');
    if (!d) throw new Error('演習 po_routed_drill がない');
    const q = d.questions[0];
    if (q.kind !== 'build') throw new Error('1 問目が設定する問いでない');
    const before = applySetup(d, 'q1', drillConfig(d), env);
    expect(judgeBuild(q, before, engine)).toBe(false);
    const po = (uid: string, channel: number, ip: string): Change => ({ kind: 'config', uid, change: { kind: 'po', channel, ip, prefix: 24 } });
    const fixed: Drill = { ...d, setup: [...(d.setup ?? []), { before: 'q1', change: [po('SW1', 1, '10.20.30.1'), po('SW2', 1, '10.20.30.2')] }] };
    const after = applySetup(fixed, 'q1', drillConfig(fixed), env);
    expect(judgeBuild(q, after, engine)).toBe(true);
  });
});
