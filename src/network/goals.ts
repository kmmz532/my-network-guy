// 案件の達成条件（goals）の判定ハンドラ。種類ごとにハンドラを登録し、案件データから呼び出す。
import type { Contract, Goal } from '../data/schema';
import { http, ping, wirelessAssociations } from './engine';
import { resolveName } from './resolve';
import type { EngineData, Failure, Network, PathResult } from './types';

export interface GoalResult {
  goal: Goal;
  ok: boolean;
  failure?: Failure;
  // 判定した経路（自動検収でパケットを流すために使う）
  kind: 'ping' | 'http';
  src: string;
  dst: string;
  result: PathResult;
}

type Handler = (goal: Goal, net: Network, data: EngineData) => GoalResult[];

const uidsOf = (net: Network, data: EngineData, category: string): string[] =>
  net.nodes.filter((n) => data.categoryOf(n.device) === category).map((n) => n.uid);

// 判定する機器がないときの不合格
const none = (goal: Goal, kind: 'ping' | 'http'): GoalResult => ({
  goal,
  ok: false,
  kind,
  src: '',
  dst: '',
  result: { ok: false, path: [] },
});

// 案件の placed[].ref は配置した機器のuidとして扱う
const handlers: { [K in Goal['type']]: Handler } = {
  ping: (goal, net, data) => {
    if (goal.type !== 'ping') throw new Error('ping ハンドラに別の種類が渡された');
    const r = ping(net, data, goal.from, goal.to);
    return [{ goal, ok: r.ok, failure: r.failure, kind: 'ping', src: goal.from, dst: goal.to, result: r }];
  },
  ping_all: (goal, net, data) => {
    if (goal.type !== 'ping_all') throw new Error('ping_all ハンドラに別の種類が渡された');
    // $all_pcs は、判定の時点でネットワークにあるPCすべてとする（自社案件）
    const nodes = goal.nodes === '$all_pcs' ? uidsOf(net, data, 'pc') : goal.nodes;
    // 疎通は往復で判定するため、組み合わせは順不同の全ペアで足りる
    const results: GoalResult[] = [];
    if (nodes.length < 2) return [none(goal, 'ping')];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const r = ping(net, data, nodes[i], nodes[j]);
        results.push({ goal, ok: r.ok, failure: r.failure, kind: 'ping', src: nodes[i], dst: nodes[j], result: r });
      }
    }
    return results;
  },
  http: (goal, net, data) => {
    if (goal.type !== 'http') throw new Error('http ハンドラに別の種類が渡された');
    const r = http(net, data, goal.from, goal.to, goal.port);
    return [{ goal, ok: r.ok, failure: r.failure, kind: 'http', src: goal.from, dst: goal.to, result: r }];
  },
  count: (goal, net, data) => {
    if (goal.type !== 'count') throw new Error('count ハンドラに別の種類が渡された');
    const ok = uidsOf(net, data, goal.category).length >= goal.min;
    return [{ ...none(goal, 'ping'), ok, result: { ok, path: [] } }];
  },
  // 無線の端末が、アクセスポイントに一定数以上つながる（電波の範囲・SSID・パスワードで決まる。N152）
  wireless_clients: (goal, net, data) => {
    if (goal.type !== 'wireless_clients') throw new Error('wireless_clients ハンドラに別の種類が渡された');
    const ok = wirelessAssociations(net, data).length >= goal.min;
    return [{ ...none(goal, 'ping'), ok, result: { ok, path: [] } }];
  },
  count_device: (goal, net) => {
    if (goal.type !== 'count_device') throw new Error('count_device ハンドラに別の種類が渡された');
    const ok = net.nodes.filter((n) => n.device === goal.device).length >= goal.min;
    return [{ ...none(goal, 'ping'), ok, result: { ok, path: [] } }];
  },
  // すべての PC が、そのカテゴリの機器のどれか1台へ届く（PC ごとに、届く機器のうち最初のものの結果）
  reach_category: (goal, net, data) => {
    if (goal.type !== 'reach_category') throw new Error('reach_category ハンドラに別の種類が渡された');
    const pcs = uidsOf(net, data, 'pc');
    const targets = uidsOf(net, data, goal.category);
    if (!pcs.length || !targets.length) return [none(goal, 'ping')];
    return pcs.map((pc) => {
      const tries = targets.map((t) => ({ t, r: ping(net, data, pc, t) }));
      const hit = tries.find((x) => x.r.ok) ?? tries[0];
      return { goal, ok: hit.r.ok, failure: hit.r.failure, kind: 'ping' as const, src: pc, dst: hit.t, result: hit.r };
    });
  },
  // すべての PC が、名前で指定の機器へ届く。PC ごとに名前を引き（対応表 → ネームサーバー）、引けた IPアドレスの機器へ Ping する（N68）
  reach_by_name: (goal, net, data) => {
    if (goal.type !== 'reach_by_name') throw new Error('reach_by_name ハンドラに別の種類が渡された');
    const pcs = uidsOf(net, data, 'pc');
    const target = net.nodes.find((n) => n.hostname === goal.name);
    if (!pcs.length || !target) return [none(goal, 'ping')];
    return pcs.map((pc) => {
      const from = net.nodes.find((n) => n.uid === pc);
      if (!from) throw new Error(`PC が見つからない: ${pc}`);
      const r = resolveName(from, goal.name, net, data);
      const dst = r.ok ? net.nodes.find((n) => n.interfaces.some((i) => i.ip === r.ip)) : undefined;
      if (!dst) {
        return { goal, ok: false, failure: { reason: 'name.unresolved' as const, node: pc }, kind: 'ping' as const, src: pc, dst: target.uid, result: { ok: false, path: [] } };
      }
      const result = ping(net, data, pc, dst.uid);
      return { goal, ok: result.ok, failure: result.failure, kind: 'ping' as const, src: pc, dst: dst.uid, result };
    });
  },
  http_all: (goal, net, data) => {
    if (goal.type !== 'http_all') throw new Error('http_all ハンドラに別の種類が渡された');
    const pcs = uidsOf(net, data, 'pc');
    const servers = uidsOf(net, data, 'server');
    if (!pcs.length || !servers.length) return [none(goal, 'http')];
    return pcs.map((pc) => {
      // 最初に閲覧できたサーバーの経路を使う。どこにも届かなければ最初のサーバーの結果を返す
      const tries = servers.map((sv) => ({ sv, r: http(net, data, pc, sv, goal.port) }));
      const hit = tries.find((x) => x.r.ok) ?? tries[0];
      return { goal, ok: hit.r.ok, failure: hit.r.failure, kind: 'http' as const, src: pc, dst: hit.sv, result: hit.r };
    });
  },
  // 通ってはいけない通信: 往路がファイアウォールの規則で止められていること（ほかの理由で届かないだけでは合格にしない）
  blocked: (goal, net, data) => {
    if (goal.type !== 'blocked') throw new Error('blocked ハンドラに別の種類が渡された');
    const r = ping(net, data, goal.from, goal.to);
    const ok = !r.ok && r.failure?.reason === 'firewall.denied';
    return [{ goal, ok, failure: r.failure, kind: 'ping', src: goal.from, dst: goal.to, result: { ...r, ok } }];
  },
  isolated: (goal, net, data) => {
    if (goal.type !== 'isolated') throw new Error('isolated ハンドラに別の種類が渡された');
    return goal.from.flatMap((src) =>
      goal.to.map((dst) => {
        const r = ping(net, data, src, dst);
        return { goal, ok: !r.ok, failure: r.failure, kind: 'ping' as const, src, dst, result: { ...r, ok: !r.ok } };
      }),
    );
  },
  http_from: (goal, net, data) => {
    if (goal.type !== 'http_from') throw new Error('http_from ハンドラに別の種類が渡された');
    const servers = uidsOf(net, data, 'server');
    if (!servers.length) return [none(goal, 'http')];
    return goal.nodes.map((src) => {
      const tries = servers.map((sv) => ({ sv, r: http(net, data, src, sv, goal.port) }));
      const hit = tries.find((x) => x.r.ok) ?? tries[0];
      return { goal, ok: hit.r.ok, failure: hit.r.failure, kind: 'http' as const, src, dst: hit.sv, result: hit.r };
    });
  },
  blocked_all: (goal, net, data) => {
    if (goal.type !== 'blocked_all') throw new Error('blocked_all ハンドラに別の種類が渡された');
    return goal.from.flatMap((src) =>
      goal.to.map((dst) => {
        const r = ping(net, data, src, dst);
        const ok = !r.ok && r.failure?.reason === 'firewall.denied';
        return { goal, ok, failure: r.failure, kind: 'ping' as const, src, dst, result: { ...r, ok } };
      }),
    );
  },
  firewall: (goal, net, data) => {
    if (goal.type !== 'firewall') throw new Error('firewall ハンドラに別の種類が渡された');
    const pcs = uidsOf(net, data, 'pc');
    const servers = uidsOf(net, data, 'server');
    if (!pcs.length || !servers.length) return [none(goal, 'ping')];
    const firewalls = new Set(uidsOf(net, data, 'firewall'));
    // PC ごとに、届くすべてのサーバーへの経路にファイアウォールがあれば成立。どこにも届かなければ不成立
    return pcs.map((pc) => {
      const tries = servers.map((sv) => ({ sv, r: ping(net, data, pc, sv) }));
      const reached = tries.filter((x) => x.r.ok);
      const bare = reached.find((x) => !x.r.path.some((uid) => firewalls.has(uid)));
      const hit = bare ?? reached[0] ?? tries[0];
      const ok = reached.length > 0 && !bare;
      return { goal, ok, failure: hit.r.failure, kind: 'ping' as const, src: pc, dst: hit.sv, result: { ...hit.r, ok } };
    });
  },
};

// 1つの達成条件を判定する。ping_all は全ペアの結果を返す
export const evaluateGoal = (goal: Goal, net: Network, data: EngineData): GoalResult[] => handlers[goal.type](goal, net, data);

export interface ContractResult {
  passed: boolean;
  results: GoalResult[];
}

// 案件のすべての達成条件を判定する。すべて成立したときに合格とする
export const evaluateContract = (contract: Contract, net: Network, data: EngineData): ContractResult => {
  const results = contract.goals.flatMap((goal) => evaluateGoal(goal, net, data));
  return { passed: results.every((r) => r.ok), results };
};
