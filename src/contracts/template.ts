// 定型案件（ひな形）から案件を生成する。PCの台数と配置は乱数で決め、同じ乱数の状態からは同じ案件になる。
import type { Contract, ContractTemplate, Goal, GameMap } from '../data/schema';
import { randInt, rand } from '../sim/rng';
import { tileKind } from '../data/tileKind';

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
}

export interface InstantiateResult {
  offer: Offer;
  rng: number;
}

// スイッチを1台置いて、全機器と配線するときの配線の長さ（タイル数の合計）が最も短い置き場所。床のマスで、機器のないマスから選ぶ
export const starHubOf = (points: readonly { x: number; y: number }[], map: GameMap): { x: number; y: number; tiles: number } => {
  let best: { x: number; y: number; tiles: number } | null = null;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (tileKind(map, x, y) !== 'floor') continue;
      if (points.some((p) => p.x === x && p.y === y)) continue;
      const tiles = points.reduce((sum, p) => sum + Math.abs(p.x - x) + Math.abs(p.y - y), 0);
      if (best === null || tiles < best.tiles) best = { x, y, tiles };
    }
  }
  if (best === null) throw new Error('床のマスがない');
  return best;
};

// 置く範囲の組（spawnGroups。spawnArea のときは1つのグループ）
export interface SpawnGroup { x: number; y: number; width: number; height: number; min: number; max: number; role?: string; name?: string }

export const spawnGroupsOf = (template: ContractTemplate): SpawnGroup[] => {
  if (template.spawnGroups !== undefined) return template.spawnGroups;
  if (template.spawnArea === undefined || template.params === undefined) {
    throw new Error(`${template.id}: spawnArea と params.pcCount が必要`);
  }
  const { x, y, width, height } = template.spawnArea;
  return [{ x, y, width, height, min: template.params.pcCount.min, max: template.params.pcCount.max }];
};

// 台数の範囲（全グループの合計）
export const pcCountRangeOf = (template: ContractTemplate): { min: number; max: number } => {
  const groups = spawnGroupsOf(template);
  return { min: groups.reduce((s, g) => s + g.min, 0), max: groups.reduce((s, g) => s + g.max, 0) };
};

export const instantiateTemplate = (
  template: ContractTemplate,
  map: GameMap,
  seq: number,
  rngState: number,
): InstantiateResult => {
  let rng = rngState;
  // グループごとに台数を決め、その範囲の床から重ならないように選ぶ（spawnArea のときは1グループで、今と同じ乱数の順）
  const placed: { ref: string; device: string; x: number; y: number; locked: boolean; name?: string }[] = [];
  // 役割ごとの PC の ref（目標の $role:<役割> の置き換えに使う）
  const roles = new Map<string, string[]>();
  for (const group of spawnGroupsOf(template)) {
    let named = 0;
    const count = randInt(rng, group.min, group.max);
    rng = count.state;
    const n = count.value;

    // 範囲のうち床のマスを候補にし、重ならないように n 個選ぶ
    const candidates: [number, number][] = [];
    for (let y = group.y; y < group.y + group.height && y < map.height; y++) {
      for (let x = group.x; x < group.x + group.width && x < map.width; x++) {
        if (tileKind(map, x, y) === 'floor') candidates.push([x, y]);
      }
    }
    if (candidates.length < n) throw new Error(`${template.id}: 置く範囲の床が ${n} 台分足りない`);
    for (let i = 0; i < n; i++) {
      const r = randInt(rng, 0, candidates.length - 1 - i);
      rng = r.state;
      const [px, py] = candidates[r.value];
      candidates[r.value] = candidates[candidates.length - 1 - i];
      if (group.role !== undefined && group.name !== undefined) {
        const list = roles.get(group.role) ?? [];
        const ref = `${group.role}_${list.length + 1}`;
        roles.set(group.role, [...list, ref]);
        named++;
        placed.push({ ref, device: 'pc_basic', x: px, y: py, locked: true, name: `${group.name}${named}` });
      } else {
        placed.push({ ref: `pc_${placed.length + 1}`, device: 'pc_basic', x: px, y: py, locked: true });
      }
    }
  }
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
    // 予算は、台数と、スイッチを中心に配線したときの配線の長さで決まる（模範の費用の約7割）
    budget: template.budget.base + template.budget.perPc * total + template.budget.perTile * starHubOf(placed, map).tiles,
    placed,
    goals,
    inhouse: false,
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
