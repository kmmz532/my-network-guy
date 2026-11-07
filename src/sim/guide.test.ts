import { describe, expect, it } from 'vitest';
import { guides } from 'virtual:game-data';
import ja from '../assets/lang/ja_jp.json';
import type { NetLink, NetNode } from '../network/types';
import { currentGuideStep, guideStepDone, parseCondition, type GuideState, type GuideStep } from './guide';

const node = (uid: string, device: string, extra: Partial<NetNode> = {}): NetNode => ({
  uid,
  device,
  x: 0,
  y: 0,
  locked: false,
  configLocked: false,
  interfaces: [],
  gateway: null,
  routes: [],
  services: [],
  ...extra,
});

const link = (uid: string, a: [string, number], b: [string, number]): NetLink => ({ paid: 0,
  uid,
  cable: 'utp_cat5e',
  a: { node: a[0], port: a[1] },
  b: { node: b[0], port: b[1] },
  path: [],
});

const categories: Record<string, string> = { pc_basic: 'pc', router_basic: 'router', l2_switch_8p: 'l2_switch' };

const base = (): GuideState => ({
  tool: 'select',
  nodes: [node('pc_a', 'pc_basic'), node('pc_b', 'pc_basic')],
  links: [],
  owned: {},
  testPassed: false,
  openRefs: [],
  categoryOf: (device) => categories[device] ?? '',
});

const c001 = guides['c001_direct_link'] as GuideStep[];

describe('parseCondition', () => {
  it('完了の条件の書式を読む', () => {
    expect(parseCondition('tool:wire')).toEqual({ kind: 'tool', tool: 'wire' });
    expect(parseCondition('links:>=1')).toEqual({ kind: 'links', min: 1 });
    expect(parseCondition('ip:pc_a')).toEqual({ kind: 'ip', ref: 'pc_a' });
    expect(parseCondition('test:pass')).toEqual({ kind: 'test' });
    expect(parseCondition('placed:router')).toEqual({ kind: 'placed', category: 'router' });
  });

  it('書式が正しくないものは null にする', () => {
    expect(parseCondition('tool:fly')).toBeNull();
    expect(parseCondition('links:1')).toBeNull();
    expect(parseCondition('test:fail')).toBeNull();
    expect(parseCondition('nothing')).toBeNull();
  });
});

describe('guideStepDone', () => {
  it('道具・配線・IPアドレス・テストの条件を判定する', () => {
    const s = base();
    expect(guideStepDone({ key: 'k', target: 'x', done: 'tool:wire' }, s)).toBe(false);
    expect(guideStepDone({ key: 'k', target: 'x', done: 'tool:select' }, s)).toBe(true);

    const linked = { ...s, links: [link('l1', ['pc_a', 0], ['pc_b', 0])] };
    expect(guideStepDone({ key: 'k', target: 'x', done: 'links:>=1' }, linked)).toBe(true);
    expect(guideStepDone({ key: 'k', target: 'x', done: 'linked:pc_b' }, linked)).toBe(true);

    // つながっていなければ、IPアドレスを付けても ip は満たさない
    const withIp = { ...s, nodes: [node('pc_a', 'pc_basic', { interfaces: [{ port: 0, ip: '192.168.1.10', prefix: 24 }] }), node('pc_b', 'pc_basic')] };
    expect(guideStepDone({ key: 'k', target: 'x', done: 'ip:pc_a' }, withIp)).toBe(false);
    const linkedWithIp = { ...withIp, links: [link('l1', ['pc_a', 0], ['pc_b', 0])] };
    expect(guideStepDone({ key: 'k', target: 'x', done: 'ip:pc_a' }, linkedWithIp)).toBe(true);
    expect(guideStepDone({ key: 'k', target: 'x', done: 'ip:pc_b' }, linkedWithIp)).toBe(false);

    expect(guideStepDone({ key: 'k', target: 'x', done: 'test:pass' }, { ...s, testPassed: true })).toBe(true);
  });

  it('機器の数やカテゴリの条件を判定する', () => {
    const s = base();
    expect(guideStepDone({ key: 'k', target: 'x', done: 'placed:pc' }, s)).toBe(true);
    expect(guideStepDone({ key: 'k', target: 'x', done: 'placed:router' }, s)).toBe(false);
    expect(guideStepDone({ key: 'k', target: 'x', done: 'owned:l2_switch_8p' }, { ...s, owned: { l2_switch_8p: 1 } })).toBe(true);
    expect(guideStepDone({ key: 'k', target: 'x', done: 'open:pc_a' }, { ...s, openRefs: ['pc_a'] })).toBe(true);
  });
});

describe('currentGuideStep（c001）', () => {
  it('状態を変えるたびに、次の手順へ順に進む', () => {
    let state = base();
    let done = 0;
    const at = () => {
      const cur = currentGuideStep(c001, state, done);
      if (cur) done = cur.index;
      return cur ? cur.step.key : null;
    };

    expect(at()).toBe('guide.c001_direct_link.1');
    state = { ...state, tool: 'wire' };
    expect(at()).toBe('guide.c001_direct_link.2');
    state = { ...state, links: [link('l1', ['pc_a', 0], ['pc_b', 0])] };
    expect(at()).toBe('guide.c001_direct_link.3');
    state = { ...state, nodes: [node('pc_a', 'pc_basic', { interfaces: [{ port: 0, ip: '192.168.1.10', prefix: 24 }] }), state.nodes[1]] };
    expect(at()).toBe('guide.c001_direct_link.4');
    state = { ...state, nodes: [state.nodes[0], node('pc_b', 'pc_basic', { interfaces: [{ port: 0, ip: '192.168.1.11', prefix: 24 }] })] };
    expect(at()).toBe('guide.c001_direct_link.5');
    state = { ...state, testPassed: true };
    expect(at()).toBeNull();
  });

  it('一度満たした手順は、元に戻しても前に戻らない', () => {
    const wired = { ...base(), tool: 'wire' };
    const first = currentGuideStep(c001, wired, 0);
    expect(first?.index).toBe(1);
    // 道具を選び直しても、完了の位置は保たれる
    const back = currentGuideStep(c001, { ...wired, tool: 'select' }, first!.index);
    expect(back?.index).toBe(1);
  });

  it('条件を満たしている手順は飛ばす（1回の操作で複数の手順が進む場合）', () => {
    const state = { ...base(), tool: 'wire', links: [link('l1', ['pc_a', 0], ['pc_b', 0])] };
    expect(currentGuideStep(c001, state, 0)?.index).toBe(2);
  });
});

describe('実際の案内のデータ', () => {
  it('案件ごとに手順があり、文言は20文字以内で、キーが言語ファイルにある', () => {
    expect(Object.keys(guides).sort()).toEqual(
      ['c001_direct_link', 'c002_small_office', 'c003_departments', 'c004_web_server', 'i001_office_lan'],
    );
    const dict = ja as Record<string, string>;
    for (const steps of Object.values(guides)) {
      for (const step of steps) {
        expect(parseCondition(step.done)).not.toBeNull();
        expect(dict[step.key]).toBeDefined();
        expect([...dict[step.key]].length).toBeLessThanOrEqual(20);
      }
    }
  });
});
