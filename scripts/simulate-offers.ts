// 依頼の出方と、会社のレベルの推移を数値で確かめる（N22・N55）。実際の判定（refreshOffers）を使い、日数ぶん時間を進める。
// 届いた依頼は、解放レベルの低いものから、1日あたりの受注数まで受けて、その日のうちに納品したものとする。
// 納品の経験値は deliveryExpOf、補助の経験値は「1日の上限の半分を毎日使う」と仮定する（AUX_USE）。
// 使い方: npx vite-node scripts/simulate-offers.ts [日数] [評判] [完了した固定案件の数] [1日の受注数] [補助の使用割合] [開始のレベル] [レベルを固定するか（1で固定）]
// 届いた依頼の種類の割合（上位5・帯1 = Lv1〜9 の割合）は、受注の有無にかかわらず届いたものから数える（レベルの偏りを避けるため）
import { balance, contracts, contractTemplates } from 'virtual:game-data';
import { mapLoaders } from 'virtual:loaders';
import { minutesPerDay } from '../src/sim/clock';
import { refreshOffers, type OfferEnv, type OfferState } from '../src/contracts/offers';
import { dailyExpCapOf, deliveryExpOf, expAtLevel, levelOf, needOf } from '../src/sim/level';
import { EMPTY_FAMILIARITY, familiarKeyOf, recordDelivery, type Familiarity } from '../src/sim/familiar';
import { blindDelegation } from '../src/sim/blindDelegate';
import { delegateModeOf, fixedNodes } from '../src/sim/project';
import { devices as deviceData } from 'virtual:game-data';
import type { GameMap } from '../src/data/schema';

const days = Number(process.argv[2] ?? 365);
const reputation = Number(process.argv[3] ?? 10);
const fixedDone = Number(process.argv[4] ?? contracts.filter((c) => !c.inhouse).length);
const perDay = Number(process.argv[5] ?? 1);
const auxUse = Number(process.argv[6] ?? 0.5);
const startLevel = Number(process.argv[7] ?? 1);
// 1 なら、会社のレベルを開始のレベルに毎日そろえる（そのレベルで届く依頼の割合を見るため）
const holdLevel = process.argv[8] === '1';
const typedBalance = balance as unknown as OfferEnv['balance'];

// 地図はすべて読み込んでから判定する（起動と同じ）
const maps: Record<string, GameMap> = {};
for (const [id, load] of Object.entries(mapLoaders)) maps[id] = (await load()).default;
const env: OfferEnv = {
  balance: typedBalance,
  fixed: contracts as unknown as OfferEnv['fixed'],
  templates: contractTemplates as unknown as OfferEnv['templates'],
  mapOf: (id) => maps[id],
};

const completed = contracts.filter((c) => !c.inhouse).slice(0, fixedDone).map((c) => c.id);
console.log('完了した案件:', completed.join(', ') || 'なし');
let state: OfferState = {
  minute: 0,
  companyExp: expAtLevel(startLevel, typedBalance),
  completed,
  offers: [],
  excluded: [],
  nextOfferMinute: 0,
  offerSeq: 0,
  newArrivals: {},
  rng: 12345,
} as OfferState;
const counts = new Map<string, number>();
let bursts = 0;
let arrivals = 0;
let deliveryTotal = 0;
let auxTotal = 0;
let delivered = 0;
// なじみの依頼（組ごとの納品の回数と型紙）。ゲームと同じく、設計のある納品（★2以上）で更新する。型紙なしの納品では更新しない
let familiarity: Familiarity = EMPTY_FAMILIARITY;
let blueprintDelegated = 0;
let blindDelegated = 0;
let selfDesigned = 0;
let blindRng = 777;
const starCounts = new Map<number, number>();
const milestones = [10, 30, 60, 99];
const reached = new Map<number, number>();
let lastLevel = 1;
// ひな形（変化形を含む）ごとの、解放された日・最初に届いた日・届いた回数（N51b の到達の確認）
const unlockDay = new Map<string, number>();
const firstArrival = new Map<string, number>();
const arrivalCount = new Map<string, number>();
// 依頼の ID（`<ひな形の ID>_<連番>`）から、ひな形の ID を取る
const templateOf = (contractId: string): string => contractId.replace(/_\d+$/, '');

for (let day = 0; day < days; day++) {
  state = { ...state, minute: day * minutesPerDay };
  if (holdLevel) state = { ...state, companyExp: expAtLevel(startLevel, typedBalance) };
  const idsBefore = new Set(state.offers.map((o) => o.id));
  state = refreshOffers(state, env);
  const added = state.offers.filter((o) => !idsBefore.has(o.id));
  for (const o of added) {
    const tid = templateOf(o.contract.id);
    arrivalCount.set(tid, (arrivalCount.get(tid) ?? 0) + 1);
    if (!firstArrival.has(tid)) firstArrival.set(tid, day);
  }
  if (added.length > 0) arrivals++;
  if (added.length >= 2) bursts++;
  // 解放レベルの低いものから、1日の受注数まで受けて納品する
  const level = levelOf(state.companyExp, typedBalance);
  const takeList = [...added].sort((a, b) => a.contract.unlockLevel - b.contract.unlockLevel).slice(0, perDay);
  for (const o of takeList) {
    const tid = templateOf(o.contract.id);
    counts.set(tid, (counts.get(tid) ?? 0) + 1);
    // 任せる判定は、ゲームの「任せる」ボタンと同じ関数（delegateModeOf）で行う。型紙の機器の位置は、届いた依頼の配置と比べる
    const mode = delegateModeOf(familiarity, o);
    const key = familiarKeyOf(o.kind, o.baseId, o.contract.map);
    let exp = deliveryExpOf(o.contract.unlockLevel, levelOf(state.companyExp, typedBalance), 1.1, typedBalance);
    let stars = 2;
    if (mode === 'blueprint') {
      exp = Math.max(1, Math.floor(exp / typedBalance.delegate.expDivisor));
      blueprintDelegated++;
    } else if (mode === 'blind') {
      exp = Math.max(1, Math.floor(exp / typedBalance.delegate.expDivisor));
      // 能力: 担当は社員2人で、その施工力は会社のレベルより緩やかに育つと見る（2人の level = 2 + 会社のレベル ÷ 10）。PC の台数は依頼の配置から数える
      const pcCount = o.contract.placed.filter((p) => (deviceData as Record<string, { category: string }>)[p.device]?.category === 'pc').length;
      const staffLevel = 2 + Math.floor(level / 10);
      const result = blindDelegation(2 * staffLevel, pcCount, 1, typedBalance, blindRng);
      blindRng = result.rng;
      stars = result.stars;
      starCounts.set(stars, (starCounts.get(stars) ?? 0) + 1);
      blindDelegated++;
    } else {
      selfDesigned++;
    }
    // 設計のある納品（自分で設計・型紙で）だけ、なじみを更新する（★2の納品。型紙なしは残さない）。設計は依頼の固定の機器で近似する
    if (mode !== 'blind' && !o.contract.inhouse) {
      familiarity = recordDelivery(familiarity, key, 2, { nodes: fixedNodes(o.contract), links: [], plans: {} });
    }
    deliveryTotal += exp;
    delivered++;
    state = { ...state, companyExp: state.companyExp + exp };
    if (o.kind === 'fixed') state = { ...state, completed: [...state.completed, o.baseId] };
  }
  // 補助の経験値（仮定: 1日の上限の一定割合）
  const aux = Math.floor(dailyExpCapOf(level, typedBalance) * auxUse);
  auxTotal += aux;
  state = { ...state, companyExp: state.companyExp + aux };
  // 届いた依頼は一覧から外す（受注か断った扱い）
  state = { ...state, offers: state.offers.filter((o) => idsBefore.has(o.id)) };
  const nowLevel = levelOf(state.companyExp, typedBalance);
  for (const t of contractTemplates) if (t.unlockLevel <= nowLevel && !unlockDay.has(t.id)) unlockDay.set(t.id, day);
  for (const m of milestones) if (nowLevel >= m && !reached.has(m)) reached.set(m, day);
  lastLevel = nowLevel;
}

const total = [...counts.values()].reduce((s, n) => s + n, 0);
console.log(`日数 ${days}・評判 ${reputation}・完了した固定案件 ${fixedDone} 件・1日の受注 ${perDay} 件・補助の使用 ${auxUse}・開始 Lv${startLevel}${holdLevel ? '（固定）' : ''}`);
const pct = (n: number): string => (delivered ? ((n / delivered) * 100).toFixed(1) : '0.0');
console.log(`納品 ${delivered} 件の内訳: 型紙で任せた ${pct(blueprintDelegated)}%（${blueprintDelegated} 件）・型紙なしで任せた ${pct(blindDelegated)}%（${blindDelegated} 件）・自分で設計 ${pct(selfDesigned)}%（${selfDesigned} 件）`);
console.log(`届いた判定 ${arrivals} 回（まとめて届いた ${bursts} 回）・届いた依頼 ${total} 件（納品 ${delivered} 件）`);
console.log(`型紙なしの結果の★: ★1 ${starCounts.get(1) ?? 0} 件・★2 ${starCounts.get(2) ?? 0} 件`);
console.log(`最後のレベル Lv${lastLevel}（経験値 ${state.companyExp}）・納品の経験値の割合 ${((deliveryTotal / (deliveryTotal + auxTotal || 1)) * 100).toFixed(1)}%`);
console.log('レベルの推移（節目）:');
for (const m of milestones) {
  const day = reached.get(m);
  console.log(`  Lv${String(m).padStart(2)} に届いた日: ${day === undefined ? '届かず' : `${day} 日目`}（必要な累計の経験値 ${expAtLevel(m, typedBalance)}・そのレベルの need ${needOf(m, typedBalance)}）`);
}
console.log('依頼ごとの件数と割合:');
for (const [id, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${id.padEnd(24)} ${String(n).padStart(5)} 件  ${total ? ((n / total) * 100).toFixed(1) : '0.0'}%`);
}
// 届いた定型案件の種類の割合（上位5と、帯1 = 解放のレベル Lv1〜9 の割合）。変化形は元のひな形の解放のレベルで数える
const rootLevelOf = (tid: string): number => {
  const t = contractTemplates.find((x) => x.id === tid);
  return contractTemplates.find((x) => x.id === (t?.textId ?? tid))?.unlockLevel ?? 0;
};
const arrivedKinds = [...arrivalCount.entries()].filter(([id]) => contractTemplates.some((t) => t.id === id));
const arrivedSum = arrivedKinds.reduce((s, [, n]) => s + n, 0);
const shareText = (n: number): string => (arrivedSum ? ((n / arrivedSum) * 100).toFixed(1) : '0.0');
const band1 = arrivedKinds.filter(([id]) => rootLevelOf(id) <= 9).reduce((s, [, n]) => s + n, 0);
console.log(`届いた定型案件 ${arrivedSum} 件の上位5: ${[...arrivedKinds].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, n]) => `${id} ${shareText(n)}%`).join(' / ')}`);
console.log(`帯1（Lv1〜9）の種類の割合: ${shareText(band1)}%`);
console.log('ひな形ごとの到達（解放レベル・レベルに届いた日・最初に届いた日・届いた回数）:');
for (const t of [...contractTemplates].sort((a, b) => a.unlockLevel - b.unlockLevel || a.id.localeCompare(b.id))) {
  const u = unlockDay.get(t.id);
  const first = firstArrival.get(t.id);
  console.log(`  ${t.id.padEnd(26)} Lv${String(t.unlockLevel).padStart(2)}  解放 ${u === undefined ? '届かず' : `${u} 日目`}  初回 ${first === undefined ? '-' : `${first} 日目`}  到着 ${arrivalCount.get(t.id) ?? 0} 回`);
}
// 合格の確認（N51b）: 到達したひな形は1件以上届く。新しい種類（announce）は解放から10日以内に最初の1件が届く
const missing: string[] = [];
const late: string[] = [];
for (const t of contractTemplates) {
  const u = unlockDay.get(t.id);
  if (u === undefined) continue;
  const first = firstArrival.get(t.id);
  if (first === undefined) missing.push(t.id);
  else if (t.announce && first - u > 10) late.push(`${t.id}（${first - u} 日）`);
}
console.log(`合格の確認: 届かないひな形 ${missing.length} 件${missing.length ? '（' + missing.join(', ') + '）' : ''}・解放から10日を超えて初回が届いた新しい種類 ${late.length} 件${late.length ? '（' + late.join(', ') + '）' : ''}`);
