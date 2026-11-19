// 同時に流れる通信（flows）の QoS。各 flow の通り道（Ping の path。区間の取り方は pathSpeeds と同じ）を、配線の区間に分け、
// 区間ごとに通る量の合計がリンクの速さを超えたら、その区間の入口の口の qos の設定で削る。
// 区間は、通り道の隣り合う2台の間を通る配線1本の、片方向（入口は上流の機器の口）。無線・速さを持たない配線は数えない。
// 削る順: none は全 flow を同じ割合で削る。priority はマーキング（EF > AF41 > BE）の高い順に通し、残りから削る（同じ優先度は flows の順）。
// マーキング: 送信元の機器が kind から付ける（voice=EF・video=AF41・data=BE）。L2/L3 スイッチの口のうち trust がない口から入ると、その機器で BE に戻る。
import type { Flow } from '../../data/schema';
import { can } from '../capabilities';
import { ping } from '../engine';
import type { NetworkState } from '../engine/state';
import type { PathResult } from '../types';
import { hopStepsOf } from './pathSpeeds';

export type Dscp = 'EF' | 'AF41' | 'BE';

const DSCP_OF_KIND: Record<Flow['kind'], Dscp> = { voice: 'EF', video: 'AF41', data: 'BE' };
const PRIORITY_OF: Record<Dscp, number> = { EF: 3, AF41: 2, BE: 1 };

// 量の比べの許容（Mbps）と、削りの繰り返しの上限（流れが互いに逆向きに交わるとき、減り方が段々小さくなって収まる）
const EPS = 1e-6;
const MAX_ROUNDS = 1000;

export interface FlowOutcome {
  flow: Flow;
  // 通り道の判定（届かなければ ok が false で、失敗を持つ）
  result: PathResult;
  // 宛先まで届く量（Mbps）。届かないときは 0
  passedMbps: number;
  // 最初に削られた区間の入口の機器。削られていなければ null
  droppedAt: string | null;
}

// 区間（配線1本の片方向）。入口は上流の機器の口
interface Leg {
  key: string;
  capacity: number;
  entry: { node: string; port: number };
  // 入口に着いたときのマーキング
  dscp: Dscp;
}

const legsOf = (state: NetworkState, flow: Flow, path: readonly string[]): Leg[] => {
  const byUid = new Map(state.net.nodes.map((n) => [n.uid, n]));
  const portOf = (uid: string, port: number) => byUid.get(uid)?.ports?.find((p) => p.port === port);
  const legs: Leg[] = [];
  let dscp = DSCP_OF_KIND[flow.kind];
  for (let i = 0; i + 1 < path.length; i++) {
    for (const step of hopStepsOf(state, path[i], path[i + 1])) {
      if (step.mbps !== null) {
        legs.push({ key: `${step.lag === null ? step.link.uid : `lag:${step.lag}`}>${step.from.node}`, capacity: step.mbps, entry: step.from, dscp });
      }
      const device = byUid.get(step.to.node)?.device;
      if (device === undefined) throw new Error(`QoS の判定: 機器がない ${step.to.node}`);
      // スイッチ（L2・L3）は、口を切り替える能力（switchport）を持つ機器
      if (can(device, 'switchport') && portOf(step.to.node, step.to.port)?.trust !== true) dscp = 'BE';
    }
  }
  return legs;
};

// 区間に入る量（flow ごと）から、出る量を求める
const admit = (state: NetworkState, capacity: number, entry: Leg['entry'], members: { flow: number; rate: number; dscp: Dscp }[]): number[] => {
  const total = members.reduce((sum, m) => sum + m.rate, 0);
  if (total <= capacity) return members.map((m) => m.rate);
  const mode = state.net.nodes.find((n) => n.uid === entry.node)?.ports?.find((p) => p.port === entry.port)?.qos ?? 'none';
  if (mode === 'none') return members.map((m) => (m.rate * capacity) / total);
  const order = members.map((_, k) => k).sort((a, b) => PRIORITY_OF[members[b].dscp] - PRIORITY_OF[members[a].dscp] || members[a].flow - members[b].flow);
  const out = members.map(() => 0);
  let remaining = capacity;
  for (const k of order) {
    out[k] = Math.min(members[k].rate, remaining);
    remaining -= out[k];
  }
  return out;
};

export const qosOf = (state: NetworkState, flows: readonly Flow[]): FlowOutcome[] => {
  const results = flows.map((f) => ping(state, f.from, f.to));
  const legs = flows.map((f, i) => (results[i].ok ? legsOf(state, f, results[i].path) : []));
  // inbound[i][k]: flow i が k 番目の区間に入る量。減る方向にだけ動く
  const inbound = legs.map((ls, i) => ls.map(() => flows[i].mbps));
  const outbound = inbound.map((row) => [...row]);
  for (let round = 0; ; round++) {
    if (round > MAX_ROUNDS) throw new Error('QoS の判定が収まらない');
    const groups = new Map<string, { flow: number; leg: number }[]>();
    legs.forEach((ls, i) =>
      ls.forEach((l, k) => {
        const g = groups.get(l.key);
        if (g) g.push({ flow: i, leg: k });
        else groups.set(l.key, [{ flow: i, leg: k }]);
      }),
    );
    for (const members of groups.values()) {
      const first = legs[members[0].flow][members[0].leg];
      const outs = admit(state, first.capacity, first.entry, members.map((m) => ({ flow: m.flow, rate: inbound[m.flow][m.leg], dscp: legs[m.flow][m.leg].dscp })));
      members.forEach((m, j) => {
        outbound[m.flow][m.leg] = outs[j];
      });
    }
    let moved = false;
    for (const [i, row] of outbound.entries()) {
      for (let k = 0; k + 1 < row.length; k++) {
        if (row[k] < inbound[i][k + 1] - EPS) {
          inbound[i][k + 1] = row[k];
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return flows.map((flow, i) => {
    const result = results[i];
    if (!result.ok) return { flow, result, passedMbps: 0, droppedAt: null };
    const cut = outbound[i].findIndex((out, k) => out < inbound[i][k] - EPS);
    const passedMbps = outbound[i].length === 0 ? flow.mbps : outbound[i][outbound[i].length - 1];
    return { flow, result, passedMbps, droppedAt: cut < 0 ? null : legs[i][cut].entry.node };
  });
};
