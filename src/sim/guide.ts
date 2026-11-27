// 初めての概念の案内（P7）。手順の完了の条件を判定する純粋関数。画面の状態（道具・機器・配線・テスト）から判定する
import type { NetLink, NetNode } from '../network/types';
import { WINDOW_KINDS, type WindowKind } from '../ui/windows';

// 案件に属さない、新しく始めた直後の案内の ID（guides.json の contract・文言 guide.start.<n>・guidesDone・guidesHidden に使う）
export const START_GUIDE = 'start';

// 初めての出会いの案内（N175）の ID の頭（guides.json の firsts の id に付ける。guidesDone・文言 guide.first.<id>.<n>）
export const FIRST_PREFIX = 'first.';

// 新しく始めた直後の案内を出す会社か。依頼が届く遊び方で、まだ終えておらず（会社のセーブ・この端末のどちらも）、案件を1つも完了していないとき
export const startGuideDue = (s: { offers: boolean; guidesDone: readonly string[]; deviceDone: boolean; completed: readonly string[] }): boolean =>
  s.offers && !s.guidesDone.includes(START_GUIDE) && !s.deviceDone && s.completed.length === 0;

// 案内の1手順。key は文言（guide.<案件>.<n>）、target は光らせる対象（ツールバーのボタンの data-guide 名、または機器の ref）、done は完了の条件
export interface GuideStep {
  key: string;
  target: string;
  done: string;
  // 指で見せる動き。drag は target から to へなぞる（教材の手順は持たず、tap として見せる）
  gesture?: Gesture;
  to?: string;
}

export type Gesture = 'tap' | 'drag' | 'hold';

// 完了の条件の書式（done の値）
//   tool:<道具>         道具を選んでいる（select・wire・remove）
//   links:>=<n>         案件（または自社オフィス）の配線が n 本以上
//   linked:<ref>        機器がケーブルでつながっている
//   ip:<ref>            機器のつながっているポートに、IPアドレスを設定している
//   ips:<カテゴリ>      そのカテゴリの機器が1台以上あり、すべてつながっているポートにIPアドレスを設定している
//   gateway:<ref>      機器のゲートウェイを設定している
//   service:<ref>       機器にサービス（http など）が動いている
//   open:<ref>          機器の画面を開いている
//   next:<名前>         吹き出しの「次へ」を押した（見せるだけの手順。名前は読み手のための目印）
//   tab:<ref>:<タブ>    機器の画面を開いていて、そのタブ（rear・config・service・terminal）を選んでいる
//   placed:<カテゴリ>   そのカテゴリの機器を置いている
//   owned:<機材ID>      在庫に機材がある（ショップで買った）
//   test:pass           いま設計中の案件のテストに合格している
//   cmd:<命令の頭>      ターミナルでその命令を打った（教材を開いている間の履歴）
//   down:<ref>[:<口>]   機器の口をすべて、または指定の口を shutdown した
//   frames:open         パケットの中身の欄を開いた
//   sequence:open       シーケンス図の窓を開いた
//   window:<種類>       その種類の窓（offers・shop など。ui/windows.ts の WindowKind）を開いている
//   accepted:<案件の基の id>  その案件を受注した（受注中、または完了している）
//   goal:<n>            教材の n 番目（1から）の達成条件を満たした
//   answer:<問いの id>  発展の問いに正しく答えた
export type Condition =
  | { kind: 'tool'; tool: string }
  | { kind: 'links'; min: number }
  | { kind: 'linked'; ref: string }
  | { kind: 'ip'; ref: string }
  | { kind: 'ips'; category: string }
  | { kind: 'gateway'; ref: string }
  | { kind: 'service'; ref: string }
  | { kind: 'open'; ref: string }
  | { kind: 'next' }
  | { kind: 'tab'; ref: string; tab: string }
  | { kind: 'placed'; category: string }
  | { kind: 'owned'; device: string }
  | { kind: 'test' }
  | { kind: 'cmd'; prefix: string }
  | { kind: 'down'; ref: string; port: number | null }
  | { kind: 'frames' }
  | { kind: 'sequence' }
  | { kind: 'window'; window: WindowKind }
  | { kind: 'accepted'; id: string }
  | { kind: 'goal'; n: number }
  | { kind: 'answer'; id: string };

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
    case 'next':
      return { kind: 'next' };
    case 'tab': {
      const m2 = /^(.+):(rear|config|service|terminal)$/.exec(value);
      return m2 ? { kind: 'tab', ref: m2[1], tab: m2[2] } : null;
    }
    case 'placed':
      return { kind: 'placed', category: value };
    case 'owned':
      return { kind: 'owned', device: value };
    case 'test':
      return value === 'pass' ? { kind: 'test' } : null;
    case 'cmd':
      return { kind: 'cmd', prefix: value };
    case 'down': {
      const d = /^([^:]+)(?::(\d+))?$/.exec(value);
      return d ? { kind: 'down', ref: d[1], port: d[2] === undefined ? null : Number(d[2]) } : null;
    }
    case 'frames':
      return value === 'open' ? { kind: 'frames' } : null;
    case 'sequence':
      return value === 'open' ? { kind: 'sequence' } : null;
    case 'window':
      return (WINDOW_KINDS as readonly string[]).includes(value) ? { kind: 'window', window: value as WindowKind } : null;
    case 'accepted':
      return { kind: 'accepted', id: value };
    case 'goal': {
      const n = /^(\d+)$/.exec(value);
      return n && Number(n[1]) >= 1 ? { kind: 'goal', n: Number(n[1]) } : null;
    }
    case 'answer':
      return { kind: 'answer', id: value };
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
  // 機器の画面ごとの、選んでいるタブ（機器の uid → タブ）
  deviceTabs?: Readonly<Record<string, string>>;
  // 機材のカテゴリ（ゲームデータから作る）
  categoryOf: (device: string) => string;
  // 教材を開いている間に打ったターミナルの命令（教材の外では省く）
  commands?: string[];
  // パケットの中身の欄を開いたか
  framesOpened?: boolean;
  // シーケンス図の窓を開いたか
  sequenceOpened?: boolean;
  // 開いている窓の種類
  windowKinds?: readonly string[];
  // 受注した案件の基の id（受注中と完了したもの）
  acceptedIds?: readonly string[];
  // 教材の達成条件ごとの、最後のテストの結果（順は教材の goals）
  lessonGoals?: boolean[];
  // 正しく答えた発展の問いの id
  answers?: string[];
}

// 機器のつながっているポート（配線の両端のうち、この機器のもの）
const linkedPorts = (uid: string, links: NetLink[]): number[] =>
  links.flatMap((l) => [l.a, l.b]).filter((e) => e.node === uid).map((e) => e.port);

// つながっているポートのすべてに、IPアドレスが設定されているか（つながっていなければ false）
const ipReady = (node: NetNode, links: NetLink[]): boolean => {
  const ports = linkedPorts(node.uid, links);
  return ports.length > 0 && ports.every((p) => node.interfaces.some((i) => i.port === p && i.ip !== ''));
};

// 対象・条件の中の @<カテゴリ> を、そのカテゴリの最初の機器の uid に置き換える（プレイヤーが置く機器は ref が決まらないため）。まだ置いていなければ、そのまま残す
export const resolveRef = (text: string, nodes: readonly NetNode[], categoryOf: (device: string) => string): string =>
  text.replace(/@([a-z0-9_]+)/g, (whole, category: string) => nodes.find((n) => categoryOf(n.device) === category)?.uid ?? whole);

const conditionDone = (raw: Condition, s: GuideState): boolean => {
  const c = 'ref' in raw ? { ...raw, ref: resolveRef(raw.ref, s.nodes, s.categoryOf) } : raw;
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
    case 'next':
      // 「次へ」を押したことは、構成に残らない手順の記録（seen）で保つ
      return false;
    case 'tab':
      // * は、開いているどれかの機器
      if (c.ref === '*') return s.openRefs.some((ref) => s.deviceTabs?.[ref] === c.tab);
      return s.openRefs.includes(c.ref) && s.deviceTabs?.[c.ref] === c.tab;
    case 'placed':
      return s.nodes.some((n) => s.categoryOf(n.device) === c.category);
    case 'owned':
      return (s.owned[c.device] ?? 0) > 0;
    case 'test':
      return s.testPassed;
    case 'cmd':
      return (s.commands ?? []).some((cmd) => cmd.trim().startsWith(c.prefix));
    case 'down': {
      const n = node(c.ref);
      if (!n) return false;
      // 電源を切った機器は、すべての口を止めたものとして扱う
      if (c.port === null && n.powered === false) return true;
      const ports = linkedPorts(n.uid, s.links);
      const isDown = (port: number) => n.ports.some((cfg) => cfg.port === port && cfg.shutdown === true);
      return c.port === null ? ports.length > 0 && ports.every(isDown) : isDown(c.port);
    }
    case 'frames':
      return s.framesOpened === true;
    case 'sequence':
      return s.sequenceOpened === true;
    case 'window':
      return (s.windowKinds ?? []).includes(c.window);
    case 'accepted':
      return (s.acceptedIds ?? []).includes(c.id);
    case 'goal':
      return s.lessonGoals?.[c.n - 1] === true;
    case 'answer':
      return (s.answers ?? []).includes(c.id);
  }
};

// 手順の完了の条件を満たしているか。書式が正しくなければ満たしていないものとする
// 次に出す初めての出会いの案内（N175）: まだ終えておらず、出す条件を満たした最初のもの。なければ null
export const nextFirstGuide = (firsts: readonly { id: string; when: string }[], done: readonly string[], state: GuideState): string | null =>
  firsts.find((f) => !done.includes(f.id) && guideStepDone({ key: '', target: '', done: f.when }, state))?.id ?? null;

export const guideStepDone = (step: GuideStep, state: GuideState): boolean => {
  const c = parseCondition(step.done);
  return c !== null && conditionDone(c, state);
};

// 構成に残らない条件（道具の選択・画面を開いたこと・パケットの欄を開いたこと・シーケンス図を開いたこと・窓を開いたこと）。一度満たした手順を記録しておかないと、操作を終えた時点で条件が外れる
export const isTransient = (step: GuideStep): boolean => {
  const c = parseCondition(step.done);
  return c !== null && (c.kind === 'tool' || c.kind === 'open' || c.kind === 'tab' || c.kind === 'next' || c.kind === 'frames' || c.kind === 'sequence' || c.kind === 'window');
};

// 案内の進み具合。手順の位置は、条件と今の構成から求める（満たしていない最初の手順がいまの手順）。
// seen は、構成に残らない条件を満たした手順の位置の記録。from より前の手順は済んだものとして飛ばす（デバッグの開始位置）。
// latch は、今回新しく記録する手順の位置。すべて完了したら current は null
export const guideProgress = (
  steps: GuideStep[],
  state: GuideState,
  seen: readonly number[] = [],
  from = 0,
): { current: { index: number; step: GuideStep } | null; latch: number[] } => {
  const latch: number[] = [];
  let i = from;
  while (i < steps.length) {
    const transient = isTransient(steps[i]);
    const satisfied = guideStepDone(steps[i], state);
    if (!satisfied && !(transient && seen.includes(i))) break;
    if (satisfied && transient && !seen.includes(i)) latch.push(i);
    i++;
  }
  return { current: i < steps.length ? { index: i, step: steps[i] } : null, latch };
};
