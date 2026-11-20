import { describe, expect, it } from 'vitest';
import { guides } from 'virtual:game-data';
import ja from '../../resources/lang/ja_jp.json';
import type { NetLink, NetNode } from '../network/types';
import { deviceCategory } from '../registry/query';
import { guideProgress, guideStepDone, parseCondition, type GuideState, type GuideStep } from './guide';

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
  ports: [],
  ...extra,
});

const link = (uid: string, a: [string, number], b: [string, number]): NetLink => ({ paid: 0,
  uid,
  cable: 'utp_cat5e',
  a: { node: a[0], port: a[1] },
  b: { node: b[0], port: b[1] },
  path: [],
});


const base = (): GuideState => ({
  tool: 'select',
  nodes: [node('pc_a', 'pc_basic'), node('pc_b', 'pc_basic')],
  links: [],
  owned: {},
  testPassed: false,
  openRefs: [],
  categoryOf: deviceCategory,
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
    const withIp = { ...s, nodes: [node('pc_a', 'pc_basic', { interfaces: [{ id: "g0/0", kind: "port", port: 0, ip: '192.168.1.10', prefix: 24 }] }), node('pc_b', 'pc_basic')] };
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

describe('guideProgress（c001）', () => {
  const ipOf = (uid: string, ip: string) => node(uid, 'pc_basic', { interfaces: [{ id: 'g0/0', kind: 'port', port: 0, ip, prefix: 24 }] });
  const key = (state: GuideState, seen: number[] = []) => guideProgress(c001, state, seen).current?.step.key ?? null;

  it('状態を変えるたびに、次の手順へ順に進む', () => {
    let state = base();
    expect(key(state)).toBe('guide.c001_direct_link.1');
    state = { ...state, tool: 'wire' };
    expect(key(state, [0])).toBe('guide.c001_direct_link.2');
    state = { ...state, links: [link('l1', ['pc_a', 0], ['pc_b', 0])] };
    expect(key(state, [0])).toBe('guide.c001_direct_link.3');
    state = { ...state, nodes: [ipOf('pc_a', '192.168.1.10'), state.nodes[1]] };
    expect(key(state, [0])).toBe('guide.c001_direct_link.4');
    state = { ...state, nodes: [state.nodes[0], ipOf('pc_b', '192.168.1.11')] };
    expect(key(state, [0])).toBe('guide.c001_direct_link.5');
    state = { ...state, testPassed: true };
    expect(key(state, [0])).toBeNull();
  });

  it('構成を戻すと、手順も戻る', () => {
    const wired = { ...base(), tool: 'wire', links: [link('l1', ['pc_a', 0], ['pc_b', 0])] };
    expect(key(wired, [0])).toBe('guide.c001_direct_link.3');
    expect(key({ ...wired, links: [] }, [0])).toBe('guide.c001_direct_link.2');
  });

  it('構成に残らない条件は、満たした手順を記録し、道具を選び直しても戻らない', () => {
    const wired = { ...base(), tool: 'wire' };
    const first = guideProgress(c001, wired);
    expect(first.current?.index).toBe(1);
    expect(first.latch).toEqual([0]);
    // 記録がなければ、道具を戻した時点で最初の手順に戻る。記録があれば戻らない
    expect(guideProgress(c001, base()).current?.index).toBe(0);
    expect(guideProgress(c001, base(), [0]).current?.index).toBe(1);
  });

  it('開き直して記録が消えると、満たされていない最初の手順から始まる', () => {
    const state = { ...base(), tool: 'select', links: [link('l1', ['pc_a', 0], ['pc_b', 0])] };
    // 記録なし: 道具の手順が満たされていないため、最初から
    expect(guideProgress(c001, state, []).current?.index).toBe(0);
  });

  it('条件を満たしている手順は飛ばす（1回の操作で複数の手順が進む場合）', () => {
    const state = { ...base(), tool: 'wire', links: [link('l1', ['pc_a', 0], ['pc_b', 0])] };
    expect(guideProgress(c001, state).current?.index).toBe(2);
  });

  it('命令・問い・パケットの欄の条件を判定し、パケットの欄は記録で保つ', () => {
    const steps: GuideStep[] = [
      { key: 'a', target: 'x', done: 'cmd:show ip route' },
      { key: 'b', target: 'x', done: 'frames:open' },
      { key: 'c', target: 'x', done: 'answer:q1' },
    ];
    const state = { ...base(), commands: ['show ip route'], framesOpened: true };
    const p = guideProgress(steps, state);
    expect(p.current?.step.key).toBe('c');
    expect(p.latch).toEqual([1]);
    // 欄を閉じても、記録があれば戻らない。命令の履歴が消えた（開き直した）ときは最初から
    expect(guideProgress(steps, { ...state, framesOpened: false }, [1]).current?.step.key).toBe('c');
    expect(guideProgress(steps, { ...base(), framesOpened: false }, []).current?.step.key).toBe('a');
    // 問いに答えると完了する
    expect(guideProgress(steps, { ...state, answers: ['q1'] }).current).toBeNull();
  });

  it('開始位置より前の手順は済んだものとして飛ばす', () => {
    expect(guideProgress(c001, base(), [], 2).current?.index).toBe(2);
  });
});

describe('実際の案内のデータ', () => {
  it('案件ごとに手順があり、文言は20文字以内で、キーが言語ファイルにある', () => {
    expect(Object.keys(guides).sort()).toEqual(
      ['c001_direct_link', 'c002_small_office', 'c003_departments', 'c004_web_server', 'i001_office_lan', 'start'],
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

describe('学習の条件', () => {
  const step = (done: string): GuideStep => ({ key: 'k', target: 't', done });
  it('cmd・goal・frames・answer は、状態にあれば完了する', () => {
    expect(parseCondition('cmd:show ip route')).toEqual({ kind: 'cmd', prefix: 'show ip route' });
    expect(guideStepDone(step('cmd:show ip route'), base())).toBe(false);
    expect(guideStepDone(step('cmd:show ip route'), { ...base(), commands: ['show ip route 10.0.0.0'] })).toBe(true);
    expect(guideStepDone(step('goal:2'), { ...base(), lessonGoals: [true, false] })).toBe(false);
    expect(guideStepDone(step('goal:1'), { ...base(), lessonGoals: [true, false] })).toBe(true);
    expect(guideStepDone(step('frames:open'), { ...base(), framesOpened: true })).toBe(true);
    expect(guideStepDone(step('sequence:open'), { ...base(), sequenceOpened: true })).toBe(true);
    expect(guideStepDone(step('answer:q1'), { ...base(), answers: ['q1'] })).toBe(true);
  });
  it('down は、指定した口を shutdown していれば完了する', () => {
    const r = node('r1', 'router_basic', { ports: [{ port: 1, mode: 'routed', shutdown: true }] });
    const state = { ...base(), nodes: [r], links: [link('l', ['r1', 1], ['pc_a', 0])] };
    expect(guideStepDone(step('down:r1:1'), state)).toBe(true);
    expect(guideStepDone(step('down:r1:2'), state)).toBe(false);
    expect(guideStepDone(step('down:r1'), state)).toBe(true);
  });
});

describe('始めの案内 start', () => {
  const start = guides['start'] as GuideStep[];
  const offersOpen = { ...base(), windowKinds: ['offers'] };
  const accepted = { ...base(), acceptedIds: ['c001_direct_link'] };

  it('window・accepted の条件を読み、状態で判定する', () => {
    expect(parseCondition('window:offers')).toEqual({ kind: 'window', window: 'offers' });
    expect(parseCondition('window:nothing')).toBeNull();
    expect(parseCondition('accepted:c001_direct_link')).toEqual({ kind: 'accepted', id: 'c001_direct_link' });
    const win: GuideStep = { key: 'k', target: 't', done: 'window:shop' };
    expect(guideStepDone(win, offersOpen)).toBe(false);
    expect(guideStepDone(win, { ...base(), windowKinds: ['shop'] })).toBe(true);
    const acc: GuideStep = { key: 'k', target: 't', done: 'accepted:c002_small_office' };
    expect(guideStepDone(acc, accepted)).toBe(false);
    expect(guideStepDone(acc, { ...base(), acceptedIds: ['c002_small_office'] })).toBe(true);
  });

  it('依頼の窓を開く、受注する、の順に進み、窓を閉じても続きから出る', () => {
    expect(guideProgress(start, base()).current?.index).toBe(0);
    const opened = guideProgress(start, offersOpen);
    expect(opened.current?.index).toBe(1);
    expect(opened.latch).toEqual([0]);
    // 窓を閉じても、記録があれば受注の手順から出る
    expect(guideProgress(start, base(), [0]).current?.index).toBe(1);
    // 受注したら終わる（案件の案内へつながる）
    expect(guideProgress(start, accepted, [0]).current).toBeNull();
  });
});
