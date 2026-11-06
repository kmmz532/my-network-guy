// 定型案件（ひな形）から案件を生成する。PCの台数と配置は乱数で決め、同じ乱数の状態からは同じ案件になる。
import type { Contract, ContractTemplate, Goal, GameMap } from '../data/schema';
import { randInt, rand } from '../sim/rng';

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
      if (map.legend[map.tiles[y][x]] !== 'floor') continue;
      if (points.some((p) => p.x === x && p.y === y)) continue;
      const tiles = points.reduce((sum, p) => sum + Math.abs(p.x - x) + Math.abs(p.y - y), 0);
      if (best === null || tiles < best.tiles) best = { x, y, tiles };
    }
  }
  if (best === null) throw new Error('床のマスがない');
  return best;
};

export const instantiateTemplate = (
  template: ContractTemplate,
  map: GameMap,
  seq: number,
  rngState: number,
): InstantiateResult => {
  let rng = rngState;
  const count = randInt(rng, template.params.pcCount.min, template.params.pcCount.max);
  rng = count.state;
  const n = count.value;

  // spawnArea のうち床のマスを候補にし、重ならないように n 個選ぶ
  const candidates: [number, number][] = [];
  const area = template.spawnArea;
  for (let y = area.y; y < area.y + area.height && y < map.height; y++) {
    for (let x = area.x; x < area.x + area.width && x < map.width; x++) {
      if (map.legend[map.tiles[y][x]] === 'floor') candidates.push([x, y]);
    }
  }
  if (candidates.length < n) throw new Error(`${template.id}: spawnArea の床が ${n} 台分足りない`);
  const picked: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const r = randInt(rng, 0, candidates.length - 1 - i);
    rng = r.state;
    picked.push(candidates[r.value]);
    candidates[r.value] = candidates[candidates.length - 1 - i];
  }

  const refs = picked.map((_, i) => `pc_${i + 1}`);
  const placed = picked.map(([x, y], i) => ({ ref: refs[i], device: 'pc_basic', x, y, locked: true }));
  const goals: Goal[] = template.goals.map((g) =>
    g.type === 'ping_all' && g.nodes === '$all_pcs' ? { type: 'ping_all', nodes: refs } : g,
  );
  const contract: Contract = {
    id: `${template.id}_${seq}`,
    stage: template.stage,
    order: 0,
    deadlineDays: template.deadlineDays,
    requires: template.requires,
    jobs: template.jobs,
    map: template.map,
    // 予算は、台数と、スイッチを中心に配線したときの配線の長さで決まる（模範の費用の約7割）
    budget: template.budget.base + template.budget.perPc * n + template.budget.perTile * starHubOf(placed, map).tiles,
    placed,
    goals,
    inhouse: false,
    reward: {
      money: template.reward.base + template.reward.perPc * n,
      reputation: template.reward.reputation,
    },
  };
  return {
    offer: { id: contract.id, kind: 'template', baseId: template.id, params: { pcCount: n }, contract },
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
