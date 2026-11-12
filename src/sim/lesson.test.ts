import { describe, expect, it } from 'vitest';
import { cables, devices, lessons } from 'virtual:game-data';
import ja from '../assets/lang/ja_jp.json';
import type { Lesson } from '../data/schema';
import type { EngineData, NetNode } from '../network/types';
import { lessonGoalResults, lessonLinks, lessonNodes } from './lesson';

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
});
