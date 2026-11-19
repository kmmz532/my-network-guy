// 教材（学習モード）の初期の構成と、達成条件の判定。画面・ストアに依存しない純粋関数
import type { Flow, Goal, Lesson } from '../data/schema';
import { evaluateGoal } from '../network/goals';
import { analyze } from '../network/engine/analyze';
import { makeIface } from '../network/iface';
import { fillPlans } from '../network/query/plans';
import type { NetworkPlan } from '../network/types';
import type { EngineData, NetLink, NetNode } from '../network/types';
import type { PlacedFurniture } from './project';

// 教材の置かれた機器。機器の uid は教材の ref と同じにする（案内の条件・達成条件が ref で指すため）
export const lessonNodes = (lesson: Pick<Lesson, 'placed'>): NetNode[] =>
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
    // setup は、口の MTU など IPアドレス以外の最初の設定と、VPN のトンネル・ファイアウォールの規則（案件の setup と同じ形）
    interfaces: (p.config?.interfaces ?? []).map((i) => {
      const { port: _port, ...extra } = p.setup?.interfaces?.find((e) => e.port === i.port) ?? { port: i.port };
      return { ...makeIface(p.device, i.port, i.ip, i.prefix), ...(i.dhcp ? { dhcp: true as const } : {}), ...structuredClone(extra) };
    }),
    gateway: p.config?.gateway ?? null,
    ...(p.isp || p.wireless || p.config?.nameServer || p.config?.proxy || p.config?.pac || p.config?.mailServer || p.setup?.vpn || p.setup?.rules
      ? { components: { ...(p.isp ? { isp: p.isp } : {}), ...(p.wireless ? { wireless: { ...p.wireless } } : {}), ...(p.config?.nameServer ? { resolver: { nameServer: p.config.nameServer } } : {}), ...(p.config?.proxy || p.config?.pac ? { proxyClient: { ...(p.config.proxy ? { proxy: { ...p.config.proxy } } : {}), ...(p.config.pac ? { pac: { direct: [...p.config.pac.direct] } } : {}) } } : {}), ...(p.config?.mailServer ? { mailClient: { server: p.config.mailServer } } : {}), ...(p.setup?.vpn ? { vpn: structuredClone(p.setup.vpn) } : {}), ...(p.setup?.rules ? { firewall: structuredClone(p.setup.rules) } : {}) } }
      : {}),
    routes: [],
    services: (p.config?.services ?? []).map((s) => ({ ...s })),
  }));

// 教材に置かれた家具。自社オフィスの家具と同じ形にする（uid は置いた順の連番）
export const lessonFurniture = (lesson: Pick<Lesson, 'furniture'>): PlacedFurniture[] =>
  (lesson.furniture ?? []).map((f, i) => ({ uid: `f${i + 1}`, id: f.id, x: f.x, y: f.y, ...(f.facing ? { facing: f.facing } : {}) }));

// 教材のアドレスの計画。IPアドレスから補う（色は保存された設定から決まる。補わないと、教材を開いた直後のケーブルが灰色のまま）
export const lessonPlans = (nodes: NetNode[], links: NetLink[], engine: EngineData): Record<string, NetworkPlan> =>
  fillPlans(analyze({ nodes, links, plans: {} }, engine));

// 教材の配線済みのケーブル。配線の長さは機器の間の最短の経路（直線）で足りるものとして、端のマスだけを持つ
export const lessonLinks = (lesson: Pick<Lesson, 'id' | 'placed' | 'links'>): NetLink[] =>
  lesson.links.map((l, i) => {
    const at = (ref: string) => {
      const p = lesson.placed.find((x) => x.ref === ref);
      if (!p) throw new Error(`教材 ${lesson.id}: 機器 ${ref} がない`);
      return [p.x, p.y] as [number, number];
    };
    return { uid: `lesson_link_${i + 1}`, cable: l.cable, a: { node: l.a.ref, port: l.a.port }, b: { node: l.b.ref, port: l.b.port }, path: [at(l.a.ref), at(l.b.ref)], paid: 0 };
  });

// 教材の達成条件を、構成に対して判定する（教材の goals の順）。条件ごとに、すべての通信が通れば true
export const lessonGoalResults = (goals: Goal[], nodes: NetNode[], links: NetLink[], engine: EngineData, flows?: readonly Flow[]): boolean[] => {
  const state = analyze({ nodes, links, plans: {} }, engine);
  return goals.map((goal) => {
    const rs = evaluateGoal(goal, state, flows);
    return rs.length > 0 && rs.every((r) => r.ok);
  });
};
