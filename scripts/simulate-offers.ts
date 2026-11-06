// 依頼の出方を数値で確かめる（N22）。実際の判定（refreshOffers）を使い、日数ぶん時間を進めて、
// ひな形ごとの届いた件数の割合と、まとめて届いた回数を出す。
// 使い方: npx vite-node scripts/simulate-offers.ts [日数] [評判] [完了した固定案件の数]
import { balance, contracts, contractTemplates } from 'virtual:game-data';
import { mapLoaders } from 'virtual:loaders';
import { minutesPerDay } from '../src/sim/clock';
import { refreshOffers, type OfferEnv, type OfferState } from '../src/contracts/offers';
import type { GameMap } from '../src/data/schema';

const days = Number(process.argv[2] ?? 365);
const reputation = Number(process.argv[3] ?? 10);
const fixedDone = Number(process.argv[4] ?? contracts.filter((c) => !c.inhouse).length);

// 地図はすべて読み込んでから判定する（起動と同じ）
const maps: Record<string, GameMap> = {};
for (const [id, load] of Object.entries(mapLoaders)) maps[id] = (await load()).default;
const env: OfferEnv = {
  balance: balance as unknown as OfferEnv['balance'],
  fixed: contracts as unknown as OfferEnv['fixed'],
  templates: contractTemplates as unknown as OfferEnv['templates'],
  mapOf: (id) => maps[id],
};

const completed = contracts.filter((c) => !c.inhouse).slice(0, fixedDone).map((c) => c.id);
console.log('完了した案件:', completed.join(', ') || 'なし');
let state: OfferState = {
  minute: 0,
  reputation,
  completed,
  offers: [],
  excluded: [],
  nextOfferMinute: 0,
  offerSeq: 0,
  rng: 12345,
};
const counts = new Map<string, number>();
let bursts = 0;
let arrivals = 0;
const seen = new Set<string>();
for (let day = 0; day < days; day++) {
  state = { ...state, minute: day * minutesPerDay };
  const idsBefore = new Set(state.offers.map((o) => o.id));
  state = refreshOffers(state, env);
  const added = state.offers.filter((o) => !idsBefore.has(o.id));
  if (added.length > 0) arrivals++;
  if (added.length >= 2) bursts++;
  for (const o of added) {
    counts.set(o.baseId, (counts.get(o.baseId) ?? 0) + 1);
    seen.add(o.baseId);
  }
  // 届いた依頼は、ここで受注か断ったものとして一覧から外す（固定案件は完了の記録に入れて、次から届かないようにする）
  state = { ...state, offers: state.offers.filter((o) => idsBefore.has(o.id)) };
  for (const o of added) if (o.kind === 'fixed') state = { ...state, completed: [...state.completed, o.baseId] };
}

const total = [...counts.values()].reduce((s, n) => s + n, 0);
console.log(`日数 ${days}・評判 ${reputation}・完了した固定案件 ${fixedDone} 件`);
console.log(`届いた判定 ${arrivals} 回（まとめて届いた ${bursts} 回）・届いた依頼 ${total} 件`);
console.log('依頼ごとの件数と割合:');
for (const [id, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${id.padEnd(24)} ${String(n).padStart(5)} 件  ${total ? ((n / total) * 100).toFixed(1) : '0.0'}%`);
}
for (const t of contractTemplates) if (!seen.has(t.id)) console.log(`  ${t.id.padEnd(24)} 届かなかった（前提・評判・地図を確かめる）`);
