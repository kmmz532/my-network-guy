// 教材（学習モード）の初期の構成と、達成条件の判定。画面・ストアに依存しない純粋関数
import type { Goal, Lesson } from '../data/schema';
import { evaluateGoal } from '../network/goals';
import { compile } from '../network/compile';
import { makeIface } from '../network/iface';
import { fillSegments } from '../network/segments';
import type { SegmentConfig } from '../network/types';
import type { EngineData, NetLink, NetNode } from '../network/types';

// 教材の置かれた機器。機器の uid は教材の ref と同じにする（案内の条件・達成条件が ref で指すため）
export const lessonNodes = (lesson: Lesson): NetNode[] =>
  lesson.placed.map((p, i) => ({
    uid: p.ref,
    device: p.device,
    // MAC アドレスの連番。置いた順に振る
    macSerial: i + 1,
    ports: [],
    ...(p.name ? { name: p.name } : {}),
    x: p.x,
    y: p.y,
    locked: p.locked,
    configLocked: p.config?.locked ?? false,
    interfaces: (p.config?.interfaces ?? []).map((i) => ({ ...makeIface(p.device, i.port, i.ip, i.prefix), ...(i.dhcp ? { dhcp: true as const } : {}) })),
    gateway: p.config?.gateway ?? null,
    ...(p.isp ? { isp: p.isp } : {}),
    ...(p.wireless ? { wireless: { ...p.wireless } } : {}),
    routes: [],
    services: (p.config?.services ?? []).map((s) => ({ ...s })),
  }));

// 教材の網の設定。IP アドレスから補う（色は保存された設定から決まる。補わないと、教材を開いた直後のケーブルが灰色のまま）
export const lessonSegments = (nodes: NetNode[], links: NetLink[], engine: EngineData): Record<string, SegmentConfig> =>
  fillSegments({ nodes, links, segments: {} }, engine);

// 教材の配線済みのケーブル。配線の長さは機器の間の最短の経路（直線）で足りるものとして、端のマスだけを持つ
export const lessonLinks = (lesson: Lesson): NetLink[] =>
  lesson.links.map((l, i) => {
    const at = (ref: string) => {
      const p = lesson.placed.find((x) => x.ref === ref);
      if (!p) throw new Error(`教材 ${lesson.id}: 機器 ${ref} がない`);
      return [p.x, p.y] as [number, number];
    };
    return { uid: `lesson_link_${i + 1}`, cable: l.cable, a: { node: l.a.ref, port: l.a.port }, b: { node: l.b.ref, port: l.b.port }, path: [at(l.a.ref), at(l.b.ref)], paid: 0 };
  });

// 教材の達成条件を、構成に対して判定する（教材の goals の順）。条件ごとに、すべての通信が通れば true
export const lessonGoalResults = (goals: Goal[], nodes: NetNode[], links: NetLink[], engine: EngineData): boolean[] => {
  const net = compile({ nodes, links, segments: {} }, engine).net;
  return goals.map((goal) => {
    const rs = evaluateGoal(goal, net, engine);
    return rs.length > 0 && rs.every((r) => r.ok);
  });
};
