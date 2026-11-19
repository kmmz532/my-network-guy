// QoS: 区間ごとの合計がリンクの速さを超えたときの削り方（none は割合・priority は優先度の高い順）と、スイッチの口の信頼によるマーキング
import { describe, expect, it } from 'vitest';
import { lessons } from 'virtual:game-data';
import type { Flow } from '../data/schema';
import { lessonLinks, lessonNodes } from '../sim/lesson';
import { analyze } from './engine/analyze';
import { evaluateGoal } from './goals';
import { qosOf } from './query/qos';
import type { EngineData, PortConfig } from './types';

const engine: EngineData = { wallAt: () => false, interferers: [] };
const lesson = lessons.find((l) => l.id === 'qos_voice');
if (!lesson?.flows) throw new Error('教材 qos_voice がない');

const DATA = 0;
const VOICE = 1;

// HQ-SW の口の設定だけを変えた教材の構成（flows は、データ・音声の順）
const stateOf = (ports: PortConfig[]) => {
  const nodes = lessonNodes(lesson).map((n) => (n.uid === 'HQ_SW' ? { ...n, ports } : n));
  return analyze({ nodes, links: lessonLinks(lesson), plans: {} }, engine);
};
const queue: PortConfig = { port: 0, mode: 'access', qos: 'priority' };
const trust: PortConfig = { port: 1, mode: 'access', trust: true };
const withData = (mbps: number): Flow[] => lesson.flows!.map((f, i) => (i === DATA ? { ...f, mbps } : f));

describe('混まない区間', () => {
  it('合計が速さに収まれば、どの通信も削らない', () => {
    const out = qosOf(stateOf([]), withData(90));
    expect(out.map((o) => o.droppedAt)).toEqual([null, null]);
    expect(out.map((o) => o.passedMbps)).toEqual([90, 1]);
  });
});

describe('qos none', () => {
  it('混んだ区間の入口の機器で、全部を同じ割合で削る', () => {
    const out = qosOf(stateOf([]), withData(150));
    expect(out.map((o) => o.droppedAt)).toEqual(['HQ_SW', 'HQ_SW']);
    expect(out[DATA].passedMbps).toBeCloseTo((150 * 100) / 151);
    expect(out[VOICE].passedMbps).toBeCloseTo(100 / 151);
  });
});

describe('qos priority', () => {
  it('信頼した口から出た音声（EF）が先に通り、データから削る', () => {
    const out = qosOf(stateOf([queue, trust]), lesson.flows!);
    expect(out[VOICE].droppedAt).toBeNull();
    expect(out[VOICE].passedMbps).toBe(1);
    expect(out[DATA].droppedAt).toBe('HQ_SW');
    expect(out[DATA].passedMbps).toBeCloseTo(99);
  });

  it('信頼のない口を通ると音声のマーキングが BE に戻り、priority でも削られる', () => {
    const out = qosOf(stateOf([queue]), lesson.flows!);
    expect(out[VOICE].droppedAt).toBe('HQ_SW');
    expect(out[VOICE].passedMbps).toBe(0);
  });

  it('信頼だけで priority がなければ、割合で削られる', () => {
    expect(qosOf(stateOf([trust]), lesson.flows!)[VOICE].droppedAt).toBe('HQ_SW');
  });
});

describe('達成条件 qos_voice', () => {
  const run = (ports: PortConfig[], flow?: number[]) => evaluateGoal({ type: 'qos_voice', ...(flow ? { flow } : {}) }, stateOf(ports), lesson.flows);

  it('削られなければ合格。削られたら qos.dropped を、削られた区間の入口の機器に出す', () => {
    expect(run([queue, trust]).map((r) => r.ok)).toEqual([true]);
    const [r] = run([]);
    expect(r.ok).toBe(false);
    expect(r.failure).toEqual({ reason: 'qos.dropped', node: 'HQ_SW' });
  });

  it('flow を指定すると、その通信だけを見る（データは priority でも削られる）', () => {
    expect(run([queue, trust], [DATA]).map((r) => r.ok)).toEqual([false]);
  });

  it('通信（flows）がなければ例外', () => {
    expect(() => evaluateGoal({ type: 'qos_voice' }, stateOf([]))).toThrow();
  });
});
