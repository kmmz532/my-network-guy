// サンドボックス（自由に設計する練習場）の規則。資金・解禁・案件・時間を使わず、自社オフィスの床に機器を置いて配線する。
// 費用は差し引かず、設計は施工の待ちなしで反映する。テストは、PC とサーバーどうしの ping と、PC からサーバーへの HTTP を判定する。
import type { Goal } from '../data/schema';
import { evaluateGoal } from '../network/goals';
import { analyze } from '../network/engine/analyze';
import { warningsOf } from '../network/query/warnings';
import type { NetNode } from '../network/types';
import type { ClockState } from './clock';
import { emptyOffice, type Env, type GoalCheck, type Office, type OfficeSize, type TestResult } from './project';
import { CATEGORY, isPcCategory } from '../data/categories';
import { deviceCategory } from '../registry/query';

// PC かサーバー（サンドボックスの通信の両端）
const isPcOrServer = (category: string): boolean => isPcCategory(category) || category === CATEGORY.server;

// 床の大きさの選択肢（床の内側のマス数）。新しく始めるとき、と後で広さを変えるときに選ぶ
export const SANDBOX_SIZES: OfficeSize[] = [
  { w: 10, h: 8 },
  { w: 15, h: 10 },
  { w: 20, h: 15 },
  { w: 30, h: 20 },
];

// 既定の大きさ
export const SANDBOX_DEFAULT_SIZE: OfficeSize = { w: 15, h: 10 };

// 資金の初期値。費用は資金から差し引かず（apply で戻す）、表示は ∞ にする。ケーブルの費用の判定で足りなくならないように大きく持つ
export const SANDBOX_MONEY = 1_000_000_000_000;

// サンドボックスの床（機器・家具のない1部屋）。大きさを省くと既定の大きさ
export const sandboxOffice = (size: OfficeSize = SANDBOX_DEFAULT_SIZE): Office => emptyOffice({ ...size });

// 床の大きさを変える。広げるのは自由。狭めるときは、新しい床からはみ出す機器・家具があれば変えない
export const resizeSandboxOffice = (office: Office, size: OfficeSize): { ok: true; office: Office } | { ok: false; reason: 'shrink' } => {
  const fits = (x: number, y: number) => x <= size.w && y <= size.h;
  const outside = office.nodes.some((n) => !fits(n.x, n.y)) || office.furniture.some((f) => !fits(f.x, f.y));
  if (outside) return { ok: false, reason: 'shrink' };
  return { ok: true, office: { ...office, size: { ...size } } };
};

// 初期の時計（時間は止めたまま。給与の月の区切りは使わない）。資金は SANDBOX_MONEY
export const sandboxClock = (base: ClockState): ClockState => ({ ...base, money: SANDBOX_MONEY, ledger: null });

// テストの判定に使う達成条件。PC とサーバーの全組み合わせの ping と、PC からサーバーへの HTTP（80番）
const testGoals = (nodes: NetNode[], categoryOf: (device: string) => string): Goal[] => {
  const category = (n: NetNode) => categoryOf(n.device);
  const ends = nodes.filter((n) => isPcOrServer(category(n))).map((n) => n.uid);
  const pcs = nodes.some((n) => isPcCategory(category(n)));
  const servers = nodes.some((n) => category(n) === CATEGORY.server);
  const goals: Goal[] = [];
  if (ends.length >= 2) goals.push({ type: 'ping_all', nodes: ends });
  if (pcs && servers) goals.push({ type: 'http_all', port: 80 });
  return goals;
};

// サンドボックスの床のネットワークをテストする。判定できる組み合わせがなければ null
// 教材を開いているときは、教材の達成条件（lessonGoals）で判定する
export const sandboxTest = (office: Office, env: Env, lessonGoals?: Goal[]): TestResult | null => {
  const goals = lessonGoals ?? testGoals(office.nodes, deviceCategory);
  if (goals.length === 0) return null;
  const state = analyze({ nodes: office.nodes, links: office.links, plans: office.plans }, env.engine);
  const results = goals.flatMap((goal) => evaluateGoal(goal, state));
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
    warnings: warningsOf(state),
  };
};
