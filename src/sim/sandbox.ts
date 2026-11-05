// サンドボックス（自由に設計する練習場）の規則。資金・解禁・案件・時間を使わず、自社オフィスの床に機器を置いて配線する。
// 費用は差し引かず、設計は施工の待ちなしで反映する。テストは、PC とサーバーどうしの ping と、PC からサーバーへの HTTP を判定する。
import type { Goal } from '../data/schema';
import { evaluateGoal } from '../network/goals';
import { compile } from '../network/compile';
import type { NetNode } from '../network/types';
import type { ClockState } from './clock';
import { emptyOffice, type Env, type GoalCheck, type Office, type OfficeSize, type TestResult } from './project';

// 床の大きさ（床の内側のマス数）。仕様の例の 30 × 20
export const SANDBOX_SIZE: OfficeSize = { w: 30, h: 20 };

// 資金の初期値。費用は資金から差し引かず（apply で戻す）、表示は ∞ にする。ケーブルの費用の判定で足りなくならないように大きく持つ
export const SANDBOX_MONEY = 1_000_000_000_000;

// サンドボックスの床（機器・家具のない、広い1部屋）
export const sandboxOffice = (): Office => emptyOffice(SANDBOX_SIZE);

// 初期の時計（時間は止めたまま。給与の月の区切りは使わない）。資金は SANDBOX_MONEY
export const sandboxClock = (base: ClockState): ClockState => ({ ...base, money: SANDBOX_MONEY });

// テストの判定に使う達成条件。PC とサーバーの全組み合わせの ping と、PC からサーバーへの HTTP（80番）
const testGoals = (nodes: NetNode[], categoryOf: (device: string) => string): Goal[] => {
  const category = (n: NetNode) => categoryOf(n.device);
  const ends = nodes.filter((n) => ['pc', 'server'].includes(category(n))).map((n) => n.uid);
  const pcs = nodes.some((n) => category(n) === 'pc');
  const servers = nodes.some((n) => category(n) === 'server');
  const goals: Goal[] = [];
  if (ends.length >= 2) goals.push({ type: 'ping_all', nodes: ends });
  if (pcs && servers) goals.push({ type: 'http_all', port: 80 });
  return goals;
};

// サンドボックスの床のネットワークをテストする。判定できる組み合わせがなければ null
export const sandboxTest = (office: Office, env: Env): TestResult | null => {
  const goals = testGoals(office.nodes, env.engine.categoryOf);
  if (goals.length === 0) return null;
  const net = compile({ nodes: office.nodes, links: office.links, segments: office.segments }, env.engine).net;
  const results = goals.flatMap((goal) => evaluateGoal(goal, net, env.engine));
  const checks: GoalCheck[] = goals.map((goal) => {
    const rs = results.filter((r) => r.goal === goal);
    const seen = new Set<string>();
    const failures: GoalCheck['failures'] = [];
    for (const r of rs) {
      if (r.ok || !r.failure) continue;
      const key = `${r.failure.node}:${r.failure.reason}`;
      if (seen.has(key)) continue;
      seen.add(key);
      failures.push({ node: r.failure.node, reason: r.failure.reason });
    }
    return { ok: rs.length > 0 && rs.every((r) => r.ok), failures };
  });
  return {
    passed: results.every((r) => r.ok),
    goals: checks,
    traces: results.map((r) => ({ kind: r.kind, src: r.src, dst: r.dst, result: r.result })),
  };
};
