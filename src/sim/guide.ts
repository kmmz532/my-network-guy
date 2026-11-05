// 初めての概念の案内（P7）。手順の完了の条件を判定する純粋関数。画面の状態（道具・機器・配線・テスト）から判定する
import type { NetLink, NetNode } from '../network/types';

// 案内の1手順。key は文言（guide.<案件>.<n>）、target は光らせる対象（ツールバーのボタンの data-guide 名、または機器の ref）、done は完了の条件
export interface GuideStep {
  key: string;
  target: string;
  done: string;
}

// 完了の条件の書式（done の値）
//   tool:<道具>         道具を選んでいる（select・wire・remove）
//   links:>=<n>         案件（または自社オフィス）の配線が n 本以上
//   linked:<ref>        機器がケーブルでつながっている
//   ip:<ref>            機器のつながっているポートに、IPアドレスを設定している
//   ips:<カテゴリ>      そのカテゴリの機器が1台以上あり、すべてつながっているポートにIPアドレスを設定している
//   gateway:<ref>      機器のゲートウェイを設定している
//   service:<ref>       機器にサービス（http など）が動いている
//   open:<ref>          機器の画面を開いている
//   placed:<カテゴリ>   そのカテゴリの機器を置いている
//   owned:<機材ID>      在庫に機材がある（ショップで買った）
//   test:pass           いま設計中の案件のテストに合格している
export type Condition =
  | { kind: 'tool'; tool: string }
  | { kind: 'links'; min: number }
  | { kind: 'linked'; ref: string }
  | { kind: 'ip'; ref: string }
  | { kind: 'ips'; category: string }
  | { kind: 'gateway'; ref: string }
  | { kind: 'service'; ref: string }
  | { kind: 'open'; ref: string }
  | { kind: 'placed'; category: string }
  | { kind: 'owned'; device: string }
  | { kind: 'test' };

const GUIDE_TOOLS = ['select', 'wire', 'remove'];

// 完了の条件の文字列を読む。書式が正しくなければ null
export const parseCondition = (text: string): Condition | null => {
  const m = /^([a-z]+):(.+)$/.exec(text);
  if (!m) return null;
  const [, kind, value] = m;
  switch (kind) {
    case 'tool':
      return GUIDE_TOOLS.includes(value) ? { kind: 'tool', tool: value } : null;
    case 'links': {
      const n = /^>=(\d+)$/.exec(value);
      return n ? { kind: 'links', min: Number(n[1]) } : null;
    }
    case 'linked':
      return { kind: 'linked', ref: value };
    case 'ip':
      return { kind: 'ip', ref: value };
    case 'ips':
      return { kind: 'ips', category: value };
    case 'gateway':
      return { kind: 'gateway', ref: value };
    case 'service':
      return { kind: 'service', ref: value };
    case 'open':
      return { kind: 'open', ref: value };
    case 'placed':
      return { kind: 'placed', category: value };
    case 'owned':
      return { kind: 'owned', device: value };
    case 'test':
      return value === 'pass' ? { kind: 'test' } : null;
    default:
      return null;
  }
};

// 判定に使う画面の状態
export interface GuideState {
  // 選んでいる道具
  tool: string;
  // いま編集している機器と配線（設計中の案件、なければ自社オフィス）
  nodes: NetNode[];
  links: NetLink[];
  // 在庫（機材ID → 個数）
  owned: Record<string, number>;
  // いま設計中の案件のテストが合格しているか
  testPassed: boolean;
  // 機器の画面が開いている機器の uid
  openRefs: string[];
  // 機材のカテゴリ（ゲームデータから作る）
  categoryOf: (device: string) => string;
}

// 機器のつながっているポート（配線の両端のうち、この機器のもの）
const linkedPorts = (uid: string, links: NetLink[]): number[] =>
  links.flatMap((l) => [l.a, l.b]).filter((e) => e.node === uid).map((e) => e.port);

// つながっているポートのすべてに、IPアドレスが設定されているか（つながっていなければ false）
const ipReady = (node: NetNode, links: NetLink[]): boolean => {
  const ports = linkedPorts(node.uid, links);
  return ports.length > 0 && ports.every((p) => node.interfaces.some((i) => i.port === p && i.ip !== ''));
};

const conditionDone = (c: Condition, s: GuideState): boolean => {
  const node = (ref: string) => s.nodes.find((n) => n.uid === ref);
  switch (c.kind) {
    case 'tool':
      return s.tool === c.tool;
    case 'links':
      return s.links.length >= c.min;
    case 'linked':
      return s.links.some((l) => l.a.node === c.ref || l.b.node === c.ref);
    case 'ip': {
      const n = node(c.ref);
      return n !== undefined && ipReady(n, s.links);
    }
    case 'ips': {
      const targets = s.nodes.filter((n) => s.categoryOf(n.device) === c.category);
      return targets.length > 0 && targets.every((n) => ipReady(n, s.links));
    }
    case 'gateway': {
      const n = node(c.ref);
      return n !== undefined && n.gateway !== null && n.gateway !== '';
    }
    case 'service': {
      const n = node(c.ref);
      return n !== undefined && n.services.some((sv) => sv.protocol === 'http');
    }
    case 'open':
      return s.openRefs.includes(c.ref);
    case 'placed':
      return s.nodes.some((n) => s.categoryOf(n.device) === c.category);
    case 'owned':
      return (s.owned[c.device] ?? 0) > 0;
    case 'test':
      return s.testPassed;
  }
};

// 手順の完了の条件を満たしているか。書式が正しくなければ満たしていないものとする
export const guideStepDone = (step: GuideStep, state: GuideState): boolean => {
  const c = parseCondition(step.done);
  return c !== null && conditionDone(c, state);
};

// いまの手順を返す。done は完了した手順の数（案内はここから先へ進むだけで、戻らない）。
// 条件を満たした手順は順に完了として飛ばす。すべて完了したら null
export const currentGuideStep = (
  steps: GuideStep[],
  state: GuideState,
  done: number,
): { index: number; step: GuideStep } | null => {
  let i = done;
  while (i < steps.length && guideStepDone(steps[i], state)) i++;
  return i < steps.length ? { index: i, step: steps[i] } : null;
};
