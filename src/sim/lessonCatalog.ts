// 学習モードで開ける構成の目録。教材と、修理の依頼（経営と関係なく練習できるように）を同じ形で扱う
import type { Contract, Drill, Goal, Lesson } from '../data/schema';
import type { GuideStep } from './guide';
import { drillConfig } from './drill';
import { lessonLinks, lessonNodes, lessonPlans } from './lesson';
import { contractLinks, fixedNodes } from './project';
import type { EngineData, NetLink, NetNode, NetworkPlan } from '../network/types';

export interface LessonEntry {
  id: string;
  // 一覧のまとまり。教材は論点、修理の依頼は repair
  group: Lesson['topic'] | 'repair';
  order: number;
  titleKey: string;
  briefKey: string;
  goals: Goal[];
  // 演習のとき、その演習（画面は教材の欄ではなく演習の欄。titleKey 以外の文言は使わない）
  drill?: Drill;
  // 案内の手順（修理の依頼・演習は案内を持たない）
  guide: Pick<GuideStep, 'target' | 'done'>[];
  build: (engine: EngineData) => { size: { w: number; h: number }; nodes: NetNode[]; links: NetLink[]; plans: Record<string, NetworkPlan> };
}

// 修理の依頼の部屋の広さ。地図は非同期で読むため、置かれた機器を囲む広さにする
const REPAIR_MARGIN = 3;

export const lessonCatalogOf = (lessons: Lesson[], contracts: Contract[], drills: Drill[]): LessonEntry[] => [
  ...drills.map((d): LessonEntry => ({
    id: d.id,
    group: d.topic,
    order: d.order,
    titleKey: `drill.${d.id}.title`,
    briefKey: `drill.${d.id}.title`,
    goals: [],
    drill: d,
    guide: [],
    build: (engine) => {
      const { nodes, links } = drillConfig(d);
      return { size: d.size, nodes, links, plans: lessonPlans(nodes, links, engine) };
    },
  })),
  ...lessons.map((l): LessonEntry => ({
    id: l.id,
    group: l.topic,
    order: l.order,
    titleKey: `lesson.${l.id}.title`,
    briefKey: `lesson.${l.id}.brief`,
    goals: l.goals,
    guide: l.guide,
    build: (engine) => {
      const nodes = lessonNodes(l);
      const links = lessonLinks(l);
      return { size: l.size, nodes, links, plans: lessonPlans(nodes, links, engine) };
    },
  })),
  ...contracts
    .filter((c) => c.kind === 'repair')
    .map((c): LessonEntry => ({
      id: c.id,
      group: 'repair',
      order: c.order,
      titleKey: `contract.${c.id}.title`,
      briefKey: `contract.${c.id}.story`,
      goals: c.goals,
      guide: [],
      // 経営の依頼と同じ最初の状態にする（アドレスの計画は補わない。補うと壊れ方が隠れることがあるため）
      build: () => ({
        size: { w: Math.max(...c.placed.map((p) => p.x)) + REPAIR_MARGIN, h: Math.max(...c.placed.map((p) => p.y)) + REPAIR_MARGIN },
        nodes: fixedNodes(c),
        links: contractLinks(c),
        plans: {},
      }),
    })),
];

export const lessonEntryOf = (catalog: LessonEntry[], id: string): LessonEntry => {
  const e = catalog.find((x) => x.id === id);
  if (!e) throw new Error(`教材 ${id} がない`);
  return e;
};
