// 案件を順に処理したときの資金推移を概算する。
// 使い方: node scripts/simulate-balance.mjs [設計時間の倍率]
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DATA = new URL('../src/assets/data/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const read = (p) => JSON.parse(readFileSync(join(DATA, p), 'utf-8'));

const balance = read('balance.json');
const devices = Object.fromEntries(
  readdirSync(join(DATA, 'devices')).flatMap((f) => read(`devices/${f}`).devices).map((d) => [d.id, d]),
);
const cables = Object.fromEntries(read('cables.json').cables.map((c) => [c.id, c]));
const contracts = Object.fromEntries(
  readdirSync(join(DATA, 'contracts')).filter((f) => f.endsWith('.json')).map((f) => {
    const c = read(`contracts/${f}`);
    return [c.id, c];
  }),
);
const template = read('contracts/templates/t_small_lan.json');

// 想定する設計（購入する機材と、ケーブルごとのタイル数）と設計にかかるゲーム内時間
const plans = [
  { id: 'c001_direct_link', designHours: 6, devices: [], cables: { utp_cat5e: [7] } },
  { id: 'c002_small_office', designHours: 8, devices: ['l2_switch_8p'], cables: { utp_cat5e: [5, 4, 6] } },
  { id: 'c003_departments', designHours: 16, devices: ['router_basic', 'l2_switch_8p', 'l2_switch_8p'], cables: { utp_cat5e: [4, 4, 4, 4, 6, 6] } },
  { id: 'c004_web_server', designHours: 16, devices: ['router_basic', 'l2_switch_8p'], cables: { utp_cat5e: [4, 4, 5, 8] } },
  { id: 'c005_two_sites', designHours: 24, devices: ['router_basic', 'router_basic', 'l2_switch_8p', 'l2_switch_8p'], cables: { utp_cat5e: [4, 4, 4, 4, 3, 3], fiber_sm: [30] } },
  ...Array.from({ length: 30 }, (_, i) => 3 + (i % 4)).map((n) => ({
    id: `${template.id}(${n})`,
    template: n,
    designHours: 8,
    devices: ['l2_switch_8p'],
    cables: { utp_cat5e: Array(n).fill(5) },
  })),
];

const designScale = Number(process.argv[2] ?? 1);
const { build, staff, time } = balance;
const workMinutesPerDay = (build.workEndHour - build.workStartHour) * 60;
const minutesPerDay = 24 * 60;
const minutesPerMonth = time.daysPerMonth * minutesPerDay;

let now = 0;
let money = balance.startMoney;
let reputation = 0;
let paidMonths = 0;
const rows = [];

const paySalaries = () => {
  while ((paidMonths + 1) * minutesPerMonth <= now) {
    paidMonths++;
    money -= staff.initial.reduce((sum, s) => sum + s.salary, 0);
    rows.push({ event: `${paidMonths}か月目の給与`, day: (paidMonths * time.daysPerMonth).toFixed(1), money });
    if (money < 0) {
      rows.push({ event: '倒産', day: '', money });
      return false;
    }
  }
  return true;
};

const simulateDays = 90;
let offerAt = 0;
for (const plan of plans) {
  // 依頼は offerIntervalDays ごとに1件届く。手が空いていても依頼が届くまで待つ
  now = Math.max(now, offerAt);
  offerAt = now + balance.offerIntervalDays * minutesPerDay;
  if (now > simulateDays * minutesPerDay) break;
  let budget, reward;
  if (plan.template) {
    budget = template.budget.base + template.budget.perPc * plan.template;
    reward = template.reward.base + template.reward.perPc * plan.template;
  } else {
    budget = contracts[plan.id].budget;
    reward = contracts[plan.id].reward.money;
  }

  const deviceCost = plan.devices.reduce((s, id) => s + devices[id].price, 0);
  let cableCost = 0;
  let cableTiles = 0;
  for (const [id, lengths] of Object.entries(plan.cables)) {
    for (const len of lengths) {
      if (len > cables[id].maxLengthTiles) throw new Error(`${plan.id}: ${id} が上限長を超えている`);
      cableCost += cables[id].pricePerLink + cables[id].pricePerTile * len;
      cableTiles += len;
    }
  }
  const cost = deviceCost + cableCost;

  const workMinutes = plan.devices.length * build.minutesPerDevice + cableTiles * build.minutesPerCableTile;
  const buildDays = workMinutes / staff.initialCount / workMinutesPerDay;

  now += plan.designHours * designScale * 60;
  money -= cost;
  now += buildDays * minutesPerDay;
  if (!paySalaries()) break;

  const ratio = cost / budget;
  const stars = balance.rating.find((r) => r.maxCostRatio === null || ratio <= r.maxCostRatio).stars;
  money += reward;
  reputation += stars * balance.reputationPerStar;
  rows.push({
    event: plan.id,
    day: (now / minutesPerDay).toFixed(1),
    cost,
    budget,
    ratio: ratio.toFixed(2),
    stars,
    buildDays: buildDays.toFixed(2),
    reward,
    money,
    reputation,
  });
}

console.log(`設計時間の倍率: ${designScale}`);
console.table(rows);
console.log(`最終資金: ${money} 円 / 評判: ${reputation}`);
