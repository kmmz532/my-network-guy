// 定型案件（ひな形）から案件を生成する。PCの台数と配置は乱数で決め、同じ乱数の状態からは同じ案件になる。
import type { Contract, ContractTemplate, Goal, GameMap } from '../data/schema';
import { randInt, rand } from '../sim/rng';
import { spawnGroupsOf } from './spawn';
import { budgetOf } from './budget';
import { DEFAULT_DECOR, DEFAULT_LAYOUT, layoutDesks, placeDecor, type DeskCell, type FurnitureCell } from './layout';

// 依頼先の机（PC の下に敷く家具）と棚（窓口型）の家具 ID
const DESK_FURNITURE = 'desk_only';
const SHELF_FURNITURE = 'bookshelf';

export interface Offer {
  // 依頼の一意なID（同じひな形から複数の依頼が生まれるため、連番を含む）
  id: string;
  // 固定案件か定型案件か（完了の記録に使う）
  kind: 'fixed' | 'template';
  // 文言キーに使う元のID（固定案件の ID、またはひな形の ID）
  baseId: string;
  // 文言の置換に使う値（例: pcCount）
  params: Record<string, number>;
  contract: Contract;
  // 届いた時刻（分）。古い保存では読み込んだ時刻（移行で入れる）
  arrivedMinute?: number;
  // 受注できる期限（分）。定型案件だけ持つ。固定案件と期限のない定型案件は持たない（N39）
  expiresMinute?: number;
  // 自社の実績を見た依頼主からの提案の依頼（報酬が高い。topic はその実績の論点）
  proposal?: true;
  topic?: string;
}

export interface InstantiateResult {
  offer: Offer;
  rng: number;
}

export { starHubOf, spawnGroupsOf, pcCountRangeOf, type SpawnGroup } from './spawn';

// 机と飾りの配置を1回作る。途中で机が並べられなければ null（rng は進んだ状態を返す）
type PlacedConfig = NonNullable<Contract['placed'][number]['config']>;

// 固定のネットワークの PC の設定（192.168.<subnet>.<host>/24、ゲートウェイは .1。設定は固定）
const fixedConfig = (subnet: number, host: number): PlacedConfig => ({
  interfaces: [{ port: 0, ip: `192.168.${subnet}.${host}`, prefix: 24 }],
  gateway: `192.168.${subnet}.1`,
  services: [],
  locked: true,
});

// ネットワークごとの、次に振るホストの番号の初め
const FIRST_FIXED_HOST = 11;

interface LaidTemplate {
  placed: { ref: string; device: string; x: number; y: number; locked: boolean; name?: string; config?: PlacedConfig }[];
  roles: Map<string, string[]>;
  furniture: FurnitureCell[];
  rng: number;
}
const layoutTemplate = (template: ContractTemplate, map: GameMap, rngState: number): { laid: LaidTemplate | null; rng: number } => {
  let rng = rngState;
  const placed: LaidTemplate['placed'] = [];
  // 役割ごとの PC の ref（目標の $role:<役割> の置き換えに使う）
  const roles = new Map<string, string[]>();
  const groups = spawnGroupsOf(template);
  const kinds = template.layout ?? DEFAULT_LAYOUT;
  // 歩けない床（地図の家具・机・棚）。後の机と飾りは、これを避けて置く
  // 固定の機器の置き場所も、PC の机には使わない
  const taken = new Set<string>([...(map.furniture ?? []).map((f) => `${f.x},${f.y}`), ...(template.placed ?? []).map((p) => `${p.x},${p.y}`)]);
  const desks: DeskCell[] = [];
  const furniture: FurnitureCell[] = [];
  const nextHost = new Map<number, number>();
  for (const group of groups) {
    let named = 0;
    const count = randInt(rng, group.min, group.max);
    rng = count.state;
    const n = count.value;

    const got = layoutDesks(map, group, n, kinds, taken, desks, rng);
    rng = got.rng;
    const laid = got.laid;
    // 前のグループの机が床をふさぐと、このグループは並べられないことがある。呼び出し側で作り直す
    if (laid === null) return { laid: null, rng };
    for (const d of laid.desks) {
      taken.add(`${d.x},${d.y}`);
      desks.push(d);
      // 机の向きは、並べ方の型で決めた向きを持たせる（N171）
      furniture.push({ id: DESK_FURNITURE, x: d.x, y: d.y, facing: d.facing });
      let config: PlacedConfig | undefined;
      if (group.subnet !== undefined) {
        const host = nextHost.get(group.subnet) ?? FIRST_FIXED_HOST;
        nextHost.set(group.subnet, host + 1);
        config = fixedConfig(group.subnet, host);
      }
      if (group.role !== undefined && group.name !== undefined) {
        const list = roles.get(group.role) ?? [];
        const ref = `${group.role}_${list.length + 1}`;
        roles.set(group.role, [...list, ref]);
        named++;
        placed.push({ ref, device: 'pc_basic', x: d.x, y: d.y, locked: true, name: `${group.name}${named}`, ...(config ? { config } : {}) });
      } else {
        placed.push({ ref: `pc_${placed.length + 1}`, device: 'pc_basic', x: d.x, y: d.y, locked: true, ...(config ? { config } : {}) });
      }
    }
    for (const s of laid.shelves) {
      taken.add(`${s.x},${s.y}`);
      furniture.push({ id: SHELF_FURNITURE, x: s.x, y: s.y });
    }
  }
  // 残りの床に飾りの家具を置く。置く範囲（PC の範囲）は空けておく
  const decor = placeDecor(map, taken, desks, groups, template.decor ?? DEFAULT_DECOR, rng);
  rng = decor.rng;
  furniture.push(...decor.furniture);
  return { laid: { placed, roles, furniture, rng }, rng };
};

// 机の並べ方が決まらないときに、乱数を進めて作り直す回数（超えたら作れないとして止める）
const LAYOUT_RETRIES = 30;

export const instantiateTemplate = (
  template: ContractTemplate,
  map: GameMap,
  seq: number,
  rngState: number,
): InstantiateResult => {
  let rng = rngState;
  let result: LaidTemplate | null = null;
  for (let attempt = 0; attempt < LAYOUT_RETRIES && result === null; attempt++) {
    const tried = layoutTemplate(template, map, rng);
    rng = tried.rng;
    result = tried.laid;
  }
  if (result === null) throw new Error(`${template.id}: 置く範囲に机を並べられない`);
  const { placed, roles, furniture } = result;
  rng = result.rng;
  const total = placed.length;
  const refs = placed.map((p) => p.ref);
  // $role:<役割> を、その役割の PC の ref に置き換える。ない役割は、ひな形の誤りとして止める
  const expand = (list: readonly string[]): string[] =>
    list.flatMap((id) => {
      if (!id.startsWith('$role:')) return [id];
      const found = roles.get(id.slice('$role:'.length));
      if (found === undefined) throw new Error(`${template.id}: 役割 ${id} の PC がない`);
      return found;
    });
  const goals: Goal[] = template.goals.map((g): Goal => {
    if (g.type === 'ping_all') {
      const nodes = g.nodes === '$all_pcs' ? refs : expand(g.nodes);
      if (nodes.length < 2) throw new Error(`${template.id}: ping_all の機器が2台に足りない`);
      return { type: 'ping_all', nodes };
    }
    if (g.type === 'isolated' || g.type === 'blocked_all') return { ...g, from: expand(g.from), to: expand(g.to) };
    if (g.type === 'http_from') return { ...g, nodes: expand(g.nodes) };
    return g;
  });
  const contract: Contract = {
    id: `${template.id}_${seq}`,
    stage: template.stage,
    unlockLevel: template.unlockLevel,
    order: 0,
    deadlineDays: template.deadlineDays,
    requires: template.requires,
    jobs: template.jobs,
    map: template.map,
    // 予算は、最安の設計の費用に余裕の倍率を掛けた額（budget.ts）
    budget: budgetOf(template, map, placed, furniture),
    // PC の後に、固定の機器を置く（予算には含めない）
    placed: [...placed, ...(template.placed ?? [])],
    ...(template.links ? { links: template.links } : {}),
    // 机・棚・飾りの家具（N76）。予算には含めない
    furniture,
    goals,
    inhouse: false,
    ...(template.manualIp ? { manualIp: true } : {}),
    reward: {
      money: template.reward.base + template.reward.perPc * total,
    },
  };
  return {
    offer: {
      id: contract.id,
      kind: 'template',
      baseId: template.textId ?? template.id,
      params: { pcCount: total },
      contract,
    },
    rng,
  };
};

// 乱数の値を使って重み付きで1つ選ぶ
export const pickByWeight = <T extends { weight: number }>(items: T[], rngState: number): { item: T; rng: number } => {
  const total = items.reduce((s, i) => s + i.weight, 0);
  const r = rand(rngState);
  let x = r.value * total;
  for (const item of items) {
    x -= item.weight;
    if (x < 0) return { item, rng: r.state };
  }
  return { item: items[items.length - 1], rng: r.state };
};
