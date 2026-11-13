// 遊び方ごとの操作の記録: 経営・サンドボックス・教材のそれぞれで、同じ操作の列（機器の配置・移動・撤去、配線、設定の変更、家具の配置と撤去、店での購入）を
// 純粋な操作（src/sim）で流し、各操作の可否と失敗の理由、費用・在庫・案件の状態の変化を記録する。画面の部品は使わない。
// 遊び方ごとに違うのは、操作の入口（自社オフィスか、焦点の案件か）と、在庫・資金の扱いだけにする。
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { balance, lessons } from 'virtual:game-data';
import { gameEnv } from '../sim/env';
import { lessonLinks, lessonNodes, lessonSegments } from '../sim/lesson';
import { initialOffice, moveFurniture, placeFurniture, removeFurniture } from '../sim/furniture';
import { sandboxClock, sandboxOffice } from '../sim/sandbox';
import { buyDevice, sellDevice } from '../sim/shop';
import { connect, focusedOf, fail, type Core, type NetTarget, type Outcome, type Project } from '../sim/project';
import { placeDevice, placeInOffice, moveNode, removeFromOffice, removeLink, removeNode } from '../sim/placement';
import { setHostname, setInterface } from '../sim/netEdit';
import { deviceDef } from '../registry/query';
import type { ClockState } from '../sim/clock';
import type { GameMap } from '../data/schema';
import type { NetLink, NetNode } from '../network/types';
import officeSmall from '../assets/data/maps/office_small.json';

const snapDir = join(import.meta.dirname, 'snap');
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const env = gameEnv;
const map = officeSmall as unknown as GameMap;

const priceOfDevice = (id: string): number => deviceDef(id).price;
const priceOfFurniture = (id: string): number => {
  const f = env.furniture?.[id];
  if (!f) throw new Error(`家具 ${id} がない`);
  return f.price;
};

// 操作の入口。遊び方ごとに、自社オフィスか焦点の案件のどちらを対象にするかと、在庫・資金の扱いを決める
interface Mode {
  name: string;
  target: NetTarget;
  core: Core;
  // 機器を新しく置く（在庫・配置の規則は遊び方の入口の関数が決める）
  place: (core: Core, device: string, x: number, y: number) => Outcome;
  move: (core: Core, uid: string, x: number, y: number) => Outcome;
  remove: (core: Core, uid: string) => Outcome;
  // 直前に置いた機器・配線の uid（操作の対象を後の手順で指すため）
  lastNode: (core: Core) => string | undefined;
  lastLink: (core: Core) => string | undefined;
  // 家具の撤去・配置で、在庫を数えない（サンドボックス）かどうか
  freeStock: boolean;
}

const officeNodeUid = (core: Core): string | undefined => core.office.nodes.at(-1)?.uid;
const officeLinkUid = (core: Core): string | undefined => core.office.links.at(-1)?.uid;
const projectOf = (core: Core): Project => focusedOf(core) as Project;
const projectNodeUid = (core: Core): string | undefined => projectOf(core).nodes.at(-1)?.uid;
const projectLinkUid = (core: Core): string | undefined => projectOf(core).links.at(-1)?.uid;

// 教材（ospf_intro）の構成を焦点の案件として持つ。資金は操作の確かめに足りる額にする
const lessonCore = (): Core => {
  const lesson = lessons.find((l) => l.id === 'ospf_intro');
  if (!lesson) throw new Error('教材 ospf_intro がない');
  const nodes: NetNode[] = lessonNodes(lesson);
  const links: NetLink[] = lessonLinks(lesson);
  const project = {
    id: 'p',
    kind: 'fixed',
    baseId: lesson.id,
    params: {},
    nodes,
    links,
    segments: lessonSegments(nodes, links, env.engine),
    seq: nodes.length + 1,
    cost: 0,
    rework: 0,
    built: { nodes: [], links: [] },
    inheritedLinks: [],
    inherited: [],
    phase: 'design',
    progress: 0,
    total: 0,
    testedOk: false,
    contract: { inhouse: false, map: 'hq', furniture: [] },
  } as unknown as Project;
  return {
    office: initialOffice(env.balance),
    active: [project],
    focus: 'p',
    owned: {},
    staff: [],
    purchaseDiscount: 0,
    clock: { money: 1_000_000, ledger: null } as unknown as ClockState,
  } as unknown as Core;
};

const modes: Mode[] = [
  {
    name: '経営',
    target: 'office',
    core: { office: initialOffice(env.balance), active: [], focus: null, owned: {}, staff: [], purchaseDiscount: 0, clock: { money: 300_000, ledger: null } as unknown as ClockState } as unknown as Core,
    place: (c, d, x, y) => placeInOffice(c, d, x, y, map, env, false, false),
    move: (c, uid, x, y) => moveNode(c, uid, x, y, env, 'office', map, false),
    remove: (c, uid) => removeFromOffice(c, uid, env, false),
    lastNode: officeNodeUid,
    lastLink: officeLinkUid,
    freeStock: false,
  },
  {
    name: 'サンドボックス',
    target: 'office',
    core: {
      office: sandboxOffice(),
      active: [],
      focus: null,
      owned: {},
      staff: [],
      purchaseDiscount: 0,
      clock: sandboxClock({ minute: 0, money: 0, paidMonths: 0, ledger: null } as unknown as ClockState),
    } as unknown as Core,
    place: (c, d, x, y) => placeInOffice(c, d, x, y, map, env, true, true),
    move: (c, uid, x, y) => moveNode(c, uid, x, y, env, 'office', map, true),
    remove: (c, uid) => removeFromOffice(c, uid, env, true),
    lastNode: officeNodeUid,
    lastLink: officeLinkUid,
    freeStock: true,
  },
  {
    name: '教材',
    target: 'focus',
    core: lessonCore(),
    place: (c, d, x, y) => placeDevice(c, d, x, y, map, env),
    move: (c, uid, x, y) => moveNode(c, uid, x, y, env, 'focus', map, false),
    remove: (c, uid) => removeNode(c, uid, env),
    lastNode: projectNodeUid,
    lastLink: projectLinkUid,
    freeStock: false,
  },
];

// 操作の結果の記録の形: 資金・在庫（0 の品目は出さない）・自社オフィス・焦点の案件（費用・テストの結果を含む）
const viewOf = (core: Core) => {
  const focus = focusedOf(core);
  return {
    money: core.clock.money,
    owned: Object.entries(core.owned)
      .filter(([, n]) => n !== 0)
      .sort(([a], [b]) => a.localeCompare(b)),
    office: {
      nodes: core.office.nodes.map((n) => `${n.uid}:${n.device}@${n.x},${n.y}`),
      links: core.office.links.map((l) => `${l.uid}:${l.cable} ${l.a.node}.${l.a.port}-${l.b.node}.${l.b.port}`),
      furniture: core.office.furniture.map((f) => `${f.uid}:${f.id}@${f.x},${f.y}`),
    },
    project: focus
      ? {
          id: focus.id,
          phase: focus.phase,
          testedOk: focus.testedOk,
          cost: focus.cost,
          nodes: focus.nodes.map((n) => `${n.uid}:${n.device}@${n.x},${n.y}`),
          links: focus.links.map((l) => `${l.uid}:${l.cable} ${l.a.node}.${l.a.port}-${l.b.node}.${l.b.port}`),
        }
      : null,
  };
};

// 同じ操作の列。遊び方ごとに、操作の入口（mode）だけが違う。途中で置いた機器・配線・家具の uid は名前で覚えて後の手順で使う
type Handles = Record<string, string>;
interface Step {
  label: string;
  run: (mode: Mode, core: Core, h: Handles) => Outcome;
}

const need = (h: Handles, key: string): string => {
  const v = h[key];
  if (v === undefined) throw new Error(`操作の手順 ${key} がない（前の手順が失敗した）`);
  return v;
};

// 購入・売却の結果（資金と在庫）を、操作の結果の形に直す
type StockResult = { ok: true; money: number; owned: Record<string, number> } | { ok: false; reason: string };
const applyStock = (core: Core, r: StockResult): Outcome => (r.ok ? { ok: true, core: { ...core, clock: { ...core.clock, money: r.money }, owned: r.owned } } : fail(r.reason));

const buy = (label: string, id: string, price: number): Step => ({
  label,
  run: (_mode, core) => applyStock(core, buyDevice(core.clock.money, core.owned, id, price)),
});

const steps: Step[] = [
  buy('購入: PC（pc_basic）', 'pc_basic', priceOfDevice('pc_basic')),
  buy('購入: PC（pc_basic）をもう1台', 'pc_basic', priceOfDevice('pc_basic')),
  buy('購入: 8ポートのスイッチ（l2_switch_8p）', 'l2_switch_8p', priceOfDevice('l2_switch_8p')),
  buy('購入: 8ポートのスイッチ（l2_switch_8p）をもう1台', 'l2_switch_8p', priceOfDevice('l2_switch_8p')),
  buy('購入: ルーター（router_basic）', 'router_basic', priceOfDevice('router_basic')),
  buy('購入: 48ポートのスイッチ（l2_switch_24p）', 'l2_switch_24p', priceOfDevice('l2_switch_24p')),
  buy('購入: 机（desk）', 'desk', priceOfFurniture('desk')),
  buy('購入: 資金の足りない機器（価格は試験の値。資金を超える）', 'gpu_server', 10_000_000),
  { label: '家具の配置: 机（desk）を(6,3)へ', run: (mode, core) => placeFurniture(core, 'desk', 6, 3, map, mode.freeStock) },
  {
    label: '機器の配置: PC を机の上(2,3)へ',
    run: (mode, core, h) => {
      const r = mode.place(core, 'pc_basic', 2, 3);
      if (r.ok) h.pc1 = mode.lastNode(r.core) ?? '';
      return r;
    },
  },
  { label: '機器の配置: PC を床(6,6)へ', run: (mode, core) => mode.place(core, 'pc_basic', 6, 6) },
  {
    label: '機器の配置: スイッチを床(5,6)へ',
    run: (mode, core, h) => {
      const r = mode.place(core, 'l2_switch_8p', 5, 6);
      if (r.ok) h.sw1 = mode.lastNode(r.core) ?? '';
      return r;
    },
  },
  { label: '機器の配置: 同じマスへもう1台のスイッチ', run: (mode, core) => mode.place(core, 'l2_switch_8p', 5, 6) },
  {
    label: '機器の配置: ルーターを床(8,6)へ',
    run: (mode, core, h) => {
      const r = mode.place(core, 'router_basic', 8, 6);
      if (r.ok) h.r1 = mode.lastNode(r.core) ?? '';
      return r;
    },
  },
  {
    label: '配線: PC とスイッチ（utp_cat5e）',
    run: (mode, core, h) => {
      const r = connect(core, need(h, 'pc1'), need(h, 'sw1'), 'utp_cat5e', env, mode.target);
      if (r.ok) h.link1 = mode.lastLink(r.core) ?? '';
      return r;
    },
  },
  { label: '配線: 同じ2台をもう一度つなぐ', run: (mode, core, h) => connect(core, need(h, 'pc1'), need(h, 'sw1'), 'utp_cat5e', env, mode.target) },
  { label: '機器の移動: スイッチを(5,7)へ', run: (mode, core, h) => mode.move(core, need(h, 'sw1'), 5, 7) },
  { label: '機器の移動: スイッチを置けないマス(8,6)へ（ルーターがある）', run: (mode, core, h) => mode.move(core, need(h, 'sw1'), 8, 6) },
  { label: '設定: PC の口0に 192.168.1.10/24', run: (mode, core, h) => setInterface(core, need(h, 'pc1'), 0, '192.168.1.10', 24, env, mode.target) },
  { label: '設定: PC の口0に不正なアドレス', run: (mode, core, h) => setInterface(core, need(h, 'pc1'), 0, 'bad', 24, env, mode.target) },
  { label: '設定: PC のホスト名を pc-1 に', run: (mode, core, h) => setHostname(core, need(h, 'pc1'), 'pc-1', mode.target) },
  { label: '配線の撤去: PC とスイッチの配線', run: (mode, core, h) => removeLink(core, need(h, 'link1'), mode.target, env) },
  { label: '配線: 撤去のあと、もう一度つなぐ', run: (mode, core, h) => connect(core, need(h, 'pc1'), need(h, 'sw1'), 'utp_cat5e', env, mode.target) },
  buy('購入: 植物（plant）', 'plant', priceOfFurniture('plant')),
  {
    label: '家具の配置: 植物（plant）を(3,6)へ',
    run: (mode, core, h) => {
      const r = placeFurniture(core, 'plant', 3, 6, map, mode.freeStock);
      if (r.ok) h.plant = r.core.office.furniture.at(-1)?.uid ?? '';
      return r;
    },
  },
  { label: '家具の移動: 植物を(3,7)へ', run: (_mode, core, h) => moveFurniture(core, need(h, 'plant'), 3, 7, map) },
  {
    label: '売却: 48ポートのスイッチ（l2_switch_24p）',
    run: (_mode, core) => applyStock(core, sellDevice(core.clock.money, core.owned, 'l2_switch_24p', priceOfDevice('l2_switch_24p'), balance.sellRate)),
  },
  { label: '機器の撤去: PC', run: (mode, core, h) => mode.remove(core, need(h, 'pc1')) },
  { label: '機器の撤去: スイッチ（配線も一緒に）', run: (mode, core, h) => mode.remove(core, need(h, 'sw1')) },
  { label: '家具の撤去: 植物', run: (mode, core, h) => removeFurniture(core, need(h, 'plant'), mode.freeStock) },
];

// 遊び方ごとに、同じ操作の列を流す。失敗した操作は理由を記録して、次の操作へ進む（失敗のあとの状態も記録する）
const runPlay = (mode: Mode) => {
  let core = mode.core;
  const h: Handles = {};
  const log = steps.map((step) => {
    const r = step.run(mode, core, h);
    if (r.ok) {
      core = r.core;
      return { step: step.label, result: 'ok', state: viewOf(core) };
    }
    return { step: step.label, result: r.reason, state: viewOf(core) };
  });
  return { mode: mode.name, log };
};

describe('遊び方ごとの操作の記録', () => {
  for (const mode of modes) {
    it(mode.name, async () => {
      await expect(json(runPlay(mode))).toMatchFileSnapshot(join(snapDir, `edit-${mode.name}.json`));
    });
  }
});

describe('遊び方の入口', () => {
  it('経営とサンドボックスは自社オフィスを対象にし、教材は焦点の案件を対象にする', () => {
    expect(modes.map((m) => [m.name, m.target])).toEqual([
      ['経営', 'office'],
      ['サンドボックス', 'office'],
      ['教材', 'focus'],
    ]);
  });
});
