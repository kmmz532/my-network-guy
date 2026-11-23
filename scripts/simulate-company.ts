// 会社の釣り合いを、ゲームの純粋関数で2年ぶん進めて確かめる。内勤（営業・人事・経理）・システムエンジニア・任せる依頼を含む。
// 式は書かない。給与・依頼の届き方・内勤の効果・精算・経験値・任せる依頼の結果は、すべて src の関数を呼ぶ。
// 仮定: 自分で設計する依頼は、定型案件なら最安の設計の費用（optimalCostOf）、固定案件なら予算の 0.75 倍の費用で、期日の日に納品する。案件の枠は balance.office.projectSlots。
//       内勤・システムエンジニアは、会社のレベルで解放され、資金が給与の3か月分を超えた最初の月（候補がいる月）に雇う。
//       机と PC は雇うときに買う（経理の割引が効く）。実績（提案の依頼）・研修・昇給・退職・夜勤は扱わない。
// 使い方: npx vite-node scripts/simulate-company.ts [試行の数] [月数]
import { balance, contracts, contractTemplates } from 'virtual:game-data';
import { mapLoaders } from 'virtual:loaders';
import type { GameMap, Staff, JobId } from '../src/data/schema';
import type { Offer } from '../src/contracts/template';
import { optimalCostOf } from '../src/contracts/budget';
import { advanceTick, initialClock, minutesPerDay, minutesPerMonth, type ClockState } from '../src/sim/clock';
import { applyMoney } from '../src/sim/ledger';
import { refreshOffers, salesArrival, earlyOfferDue, type OfferEnv, type OfferState } from '../src/contracts/offers';
import { levelOf, levelUpsBetween } from '../src/sim/level';
import { dailyOpsGainOf, firstGoalGainOf, grantDailyExp, type DailyExpState } from '../src/sim/companyExp';
import { accountingRate, backOfficeP, settleTaxReturn, devDailyIncome, hrCandidateBonus, hrJuniorRate, salesArrivalChance, salesRewardMul } from '../src/sim/backOffice';
import { assignDesks, bonusEnvOf, initialOffice, pcDesksOf } from '../src/sim/furniture';
import { DESK_ID, delegateModeOf, fixedNodes, isDeskFurniture, rewardWithMul, type Office } from '../src/sim/project';
import { gainExp, initialStaff, payrollOf, rollCandidates, staffCapOf, staffPower } from '../src/sim/staff';
import { dailyExpOfStaff, devIdleStaffOf } from '../src/sim/staffDaily';
import { isFieldEngineerJob, requiresPc } from '../src/sim/jobs';
import { isOnShift } from '../src/sim/shift';
import { rate } from '../src/sim/rating';
import { blindCostOf, settlementOf } from '../src/sim/settlement';
import { blindDelegation, delegateBuildMinutesOf } from '../src/sim/blindDelegate';
import { EMPTY_FAMILIARITY, familiarKeyOf, recordDelivery, type Familiarity } from '../src/sim/familiar';
import { dayOf, dueDayOf, lateDaysOf } from '../src/sim/deadline';
import { rand } from '../src/sim/rng';
import { gameEnv, isPcDevice } from '../src/sim/env';
import { devicePrice } from '../src/registry/query';
import type { NetNode } from '../src/network/types';

const trials = Number(process.argv[2] ?? 10);
const months = Number(process.argv[3] ?? 24);
// 第4引数に skills を渡すと、遊び方の3段階の表だけを出す（調整の確認用）
const skillsOnly = process.argv[4] === 'skills';

// 固定案件の想定の解答の費用。固定案件は予算を手で決めており、最安の設計の費用を求められないため、予算の 0.75 倍（★3の費用の割合 0.8 以下）とする
const FIXED_COST_RATIO = 0.75;
const PC_ID = 'pc_basic';
// 遊び方の段階。★3は最安の設計・期日の日に納品（これまでの仮定）。★2は予算の 0.95 倍の費用。★1は予算の 1.05 倍の費用で、設計の時間が 1.5 倍かかり、期日を過ぎて納品する
type Skill = 1 | 2 | 3;
const SKILL_COST_RATIO: Record<1 | 2, number> = { 1: 1.05, 2: 0.95 };
const SKILL_TIME_MUL: Record<Skill, number> = { 1: 1.5, 2: 1, 3: 1 };

const maps: Record<string, GameMap> = {};
for (const [id, load] of Object.entries(mapLoaders)) maps[id] = (await load()).default;
const offerEnv: OfferEnv = {
  balance,
  fixed: contracts as unknown as OfferEnv['fixed'],
  templates: contractTemplates as unknown as OfferEnv['templates'],
  mapOf: (id) => maps[id],
};

interface Scenario {
  id: string;
  label: string;
  hires: JobId[];
  // 型紙なしで任せられる依頼は、任せる
  delegate: boolean;
  skill: Skill;
}

const SCENARIOS: Scenario[] = [
  { id: 'a', label: '(a) 技術職だけ', hires: [], delegate: false, skill: 3 },
  { id: 'b', label: '(b) 営業を1人足す', hires: ['sales'], delegate: false, skill: 3 },
  { id: 'c', label: '(c) 人事・経理を足す', hires: ['hr', 'accounting'], delegate: false, skill: 3 },
  { id: 'd', label: '(d) システムエンジニアを足す', hires: ['dev'], delegate: false, skill: 3 },
  { id: 'e', label: '(e) 型紙なしの任せる依頼を主に使う', hires: [], delegate: true, skill: 3 },
];

interface Row {
  money: number;
  level: number;
  salary: number;
}

interface RunResult {
  rows: Row[];
  bankrupt: boolean;
  minMoney: number;
  // 最初の1か月・3か月の資金の最低と、月末の資金
  minFirst1: number;
  minFirst3: number;
  // 職種 → 雇った月（月末の番号）。雇わなかった職種は含まない
  hiredMonth: Partial<Record<JobId, number>>;
  // 雇った社員の月給
  hiredSalary: Partial<Record<JobId, number>>;
  deliveries: number;
  // 依頼の報酬の合計と、依頼の費用（機材の購入・施工）の合計
  earned: number;
  // earned のうち、固定案件の報酬
  earnedFixed: number;
  spent: number;
  delegated: number;
  selfDesigned: number;
  stars: { one: number; two: number };
}

interface Active {
  offer: Offer;
  due: number | null;
  // 自分で設計する依頼を納品する日（設計の時間を掛けた日数のぶん、期日より後になる）
  finish: number | null;
  mode: 'self' | 'blind';
  crew: string[];
  // 型紙なしの結果（受注のときに決める）と、施工の進み
  blind?: { stars: 1 | 2; costRatio: number };
  progress: number;
  total: number;
}

const run = (scn: Scenario, seed: number): RunResult => {
  let clock: ClockState = initialClock(balance);
  let office: Office = initialOffice(balance);
  const init = initialStaff(balance, seed * 7 + 1);
  const isSeat = (id: string) => isDeskFurniture(id, gameEnv);
  let staff: Staff[] = assignDesks(init.staff, office, isSeat);
  let staffRng = init.rng;
  let staffSeq = init.staffSeq;
  let candidates: Staff[] = [];
  let companyExp = 0;
  let expState: DailyExpState = { companyExp: 0, expDay: -1, expToday: 0 };
  let familiarity: Familiarity = EMPTY_FAMILIARITY;
  let firstGoals: string[] = [];
  let offers: OfferState = {
    minute: clock.minute,
    companyExp: 0,
    completed: [],
    offers: [],
    excluded: [],
    nextOfferMinute: 0,
    offerSeq: 0,
    newArrivals: {},
    rng: seed * 13 + 5,
  };
  let active: Active | null = null;
  let pcStock = balance.initialStock.pc_basic ?? 0;
  let furnitureSeq = office.furnitureSeq;
  let deliveries = 0;
  let earned = 0;
  let earnedFixed = 0;
  let spent = 0;
  let delegatedCount = 0;
  let selfCount = 0;
  const stars = { one: 0, two: 0 };
  const pending = [...scn.hires];
  const hiredMonth: RunResult['hiredMonth'] = {};
  const hiredSalary: RunResult['hiredSalary'] = {};
  const rows: Row[] = [];
  let minMoney = clock.money;
  let minFirst1 = clock.money;
  let minFirst3 = clock.money;

  const bonusEnv = () => bonusEnvOf({ staff, office }, gameEnv);
  const pOf = (job: JobId): number => backOfficeP(staff, job, office, bonusEnv());
  const payroll = (): number => payrollOf(staff, office, bonusEnv(), balance);
  const level = (): number => levelOf(companyExp, balance);
  const addExp = (amount: number): void => {
    if (amount <= 0) return;
    const before = level();
    companyExp += amount;
    const ups = levelUpsBetween(before, level(), balance, [], []);
    const money = ups.reduce((sum, u) => sum + u.money, 0);
    if (money > 0) clock = applyMoney(clock, money, 'reward');
  };
  const hasPc = (m: Staff): boolean => m.desk !== null && pcDesksOf(office, isPcDevice).includes(m.desk);
  const fieldStaff = (): Staff[] => staff.filter((m) => isFieldEngineerJob(m.job) && m.training === null);

  // 定型案件の費用は最安の設計の費用。案件の ID は <ひな形の ID> に連番が付いた形
  const costOf = (o: Offer): number => {
    if (scn.skill !== 3) return Math.round(o.contract.budget * SKILL_COST_RATIO[scn.skill]);
    if (o.kind === 'fixed') return Math.round(o.contract.budget * FIXED_COST_RATIO);
    const templateId = o.contract.id.replace(/(_\d+)+$/, '');
    const template = contractTemplates.find((t) => t.id === templateId);
    if (!template) throw new Error(`ひな形 ${templateId} がない`);
    return optimalCostOf(template, maps[o.contract.map], o.contract.placed, o.contract.furniture ?? []);
  };
  // 営業の効果。受注する依頼の報酬は、ゲームと同じく倍率を掛けた額
  const withSalesMul = (o: Offer): Offer => ({ ...o, contract: { ...o.contract, reward: { ...o.contract.reward, money: rewardWithMul(o.contract.reward.money, salesRewardMul(pOf('sales'), balance)) } } });
  const expectedNet = (o: Offer): number => {
    const days = (o.contract.deadlineDays ?? Infinity) + 1;
    const star3 = settlementOf({ reward: withSalesMul(o).contract.reward.money, unlockLevel: o.contract.unlockLevel, stars: 3, lateDays: 0, delegated: false, companyExp }, balance);
    return (star3.money - costOf(o)) / days;
  };

  // 雇う。机（と PC の机なら PC）を買う。経理の割引が効く
  const tryHire = (job: JobId): boolean => {
    const cand = candidates.filter((c) => c.job === job).sort((x, y) => y.level - x.level)[0];
    if (!cand || staff.length >= staffCapOf(level(), balance)) return false;
    const discount = accountingRate(pOf('accounting'), balance);
    const deskPrice = gameEnv.furniture?.[DESK_ID]?.price ?? 0;
    const needPc = requiresPc(job);
    const pcPrice = needPc && pcStock === 0 ? devicePrice(PC_ID) : 0;
    const cost = Math.round((deskPrice + pcPrice) * (1 - discount));
    if (clock.money - cost <= 0) return false;
    const x = 2 + 2 * staff.length;
    const desk = { uid: `f${furnitureSeq++}`, id: DESK_ID, x, y: 3 };
    const nodes: NetNode[] = needPc ? [...office.nodes, { uid: `n${staffSeq}`, device: PC_ID, ports: [], x, y: 3 } as NetNode] : office.nodes;
    if (needPc && pcStock > 0) pcStock--;
    office = { ...office, furniture: [...office.furniture, desk], furnitureSeq, nodes };
    clock = applyMoney(clock, -cost, 'purchase');
    staff = [...staff, { ...cand, uid: `s${staffSeq++}`, shift: 'day', desk: desk.uid, hiredMonth: clock.paidMonths, leaving: false }];
    candidates = candidates.filter((c) => c.uid !== cand.uid);
    const granted = grantDailyExp({ ...expState, companyExp }, 'hire', clock.minute, balance);
    expState = { companyExp: granted.companyExp, expDay: granted.expDay, expToday: granted.expToday };
    addExp(granted.gained);
    hiredMonth[job] = clock.paidMonths;
    hiredSalary[job] = cand.salary;
    return true;
  };

  const settle = (a: Active): void => {
    const c = a.offer.contract;
    let money: number;
    let expGain: number;
    let starsGot: 1 | 2 | 3;
    let first = 0;
    if (a.mode === 'blind' && a.blind) {
      starsGot = a.blind.stars;
      const s = settlementOf({ reward: c.reward.money, unlockLevel: c.unlockLevel, stars: starsGot, lateDays: 0, delegated: true, companyExp }, balance);
      money = s.money;
      expGain = s.expGain;
      const blindCost = blindCostOf(c.budget, a.blind.costRatio);
      clock = applyMoney(clock, -blindCost, 'construction');
      spent += blindCost;
      delegatedCount++;
      if (starsGot === 2) stars.two++;
      else stars.one++;
    } else {
      const late = lateDaysOf(a.due, clock.minute - 1);
      starsGot = rate(costOf(a.offer), c.budget, 0, late > 0, 0, balance);
      const s = settlementOf({ reward: c.reward.money, unlockLevel: c.unlockLevel, stars: starsGot, lateDays: late, delegated: false, companyExp }, balance);
      money = s.money;
      expGain = s.expGain;
      const g = firstGoalGainOf(firstGoals, c.goals.map((x) => x.type), companyExp, balance);
      firstGoals = [...firstGoals, ...g.types];
      first = g.gained;
      familiarity = recordDelivery(familiarity, familiarKeyOf(a.offer.kind, a.offer.baseId, c.map), starsGot, { nodes: fixedNodes(c), links: [], plans: {} });
      selfCount++;
    }
    clock = applyMoney(clock, money, 'reward');
    earned += money;
    if (a.offer.kind === 'fixed') earnedFixed += money;
    addExp(expGain + first);
    deliveries++;
    offers = {
      ...offers,
      excluded: offers.excluded.filter((id) => id !== a.offer.baseId),
      completed: a.offer.kind === 'fixed' ? [...offers.completed, a.offer.baseId] : offers.completed,
    };
    if (earlyOfferDue(deliveries, offers.offers.length, balance)) offers = { ...offers, nextOfferMinute: clock.minute };
    active = null;
  };

  const accept = (): void => {
    const crew = fieldStaff();
    if (crew.length === 0) return;
    const discount = accountingRate(pOf('accounting'), balance);
    const price = (o: Offer): number => Math.round(costOf(o) * (1 - discount));
    const eligible = offers.offers.filter((o) => !o.contract.inhouse && o.contract.deadlineDays !== undefined && price(o) <= clock.money);
    if (eligible.length === 0) return;
    const offer = withSalesMul(eligible.reduce((best, o) => (expectedNet(o) > expectedNet(best) ? o : best)));
    offers = { ...offers, offers: offers.offers.filter((o) => o.id !== offer.id), excluded: [...offers.excluded, offer.baseId] };
    const mode = scn.delegate && delegateModeOf(familiarity, offer) !== null ? 'blind' : 'self';
    const due = dueDayOf(clock.minute, offer.contract.deadlineDays);
    const extra = due === null ? 0 : Math.ceil((offer.contract.deadlineDays ?? 0) * (SKILL_TIME_MUL[scn.skill] - 1));
    const a: Active = { offer, due, finish: due === null ? null : due + extra, mode, crew: crew.map((m) => m.uid), progress: 0, total: 0 };
    if (mode === 'self') {
      clock = applyMoney(clock, -price(offer), 'purchase');
      spent += price(offer);
    } else {
      const jobs = offer.contract.jobs ?? [];
      const power = crew.reduce((sum, m) => sum + staffPower(m, jobs, office, bonusEnv()), 0);
      const pcCount = offer.contract.placed.filter((p) => isPcDevice(p.device)).length;
      const match = jobs.length === 0 ? 1 : crew.filter((m) => jobs.includes(m.job)).length / crew.length;
      const r = blindDelegation(power, pcCount, match, balance, offers.rng);
      offers = { ...offers, rng: r.rng };
      a.blind = { stars: r.stars, costRatio: r.costRatio };
      a.total = delegateBuildMinutesOf(offer.contract.deadlineDays, power, balance);
    }
    active = a;
  };

  const monthEnd = (): void => {
    const month = clock.paidMonths;
    clock = settleTaxReturn(clock, month - 1, pOf('accounting'), balance).clock;
    rows.push({ money: clock.money, level: level(), salary: payroll() });
    const hrP = pOf('hr');
    const wish = pending[0];
    const rolled = rollCandidates(level(), month, staffRng, balance, staff.map((m) => m.name), {
      ...hrCandidateBonus(hrP, balance),
      ...(hrP > 0 && wish !== undefined ? { wish } : {}),
    });
    candidates = rolled.candidates;
    staffRng = rolled.rng;
    if (pending.length > 0 && clock.money > 3 * payroll() && tryHire(pending[0])) pending.shift();
  };

  const totalTicks = months * (minutesPerMonth(balance) / balance.time.gameMinutesPerTick);
  const tickMinutes = balance.time.gameMinutesPerTick;
  for (let t = 0; t < totalTicks && !clock.bankrupt; t++) {
    const before = clock;
    clock = advanceTick(clock, balance, payroll());
    minMoney = Math.min(minMoney, clock.money);
    if (before.paidMonths < 1) minFirst1 = Math.min(minFirst1, clock.money);
    if (before.paidMonths < 3) minFirst3 = Math.min(minFirst3, clock.money);
    const onShift = isOnShift(clock.minute % minutesPerDay, 'day', balance);
    // 勤務中の施工: 担当の経験値と、型紙なしの進み
    if (active && onShift) {
      const crewSet = new Set(active.crew);
      const hrP = pOf('hr');
      staff = staff.map((m) => (crewSet.has(m.uid) ? gainExp(m, (tickMinutes / 60) * (m.level <= balance.backOffice.hr.juniorMaxLevel ? hrJuniorRate(hrP, balance) : 1), balance.staff.expPerLevel) : m));
      if (active.mode === 'blind') {
        const jobs = active.offer.contract.jobs ?? [];
        const power = staff.filter((m) => crewSet.has(m.uid)).reduce((sum, m) => sum + staffPower(m, jobs, office, bonusEnv()), 0);
        active = { ...active, progress: active.progress + tickMinutes * power };
        if (active.progress >= active.total) settle(active);
      }
    }
    // 依頼の到着（ゲームと同じく毎ティック判定する）
    offers = refreshOffers({ ...offers, minute: clock.minute, companyExp }, offerEnv, { rewardWeight: pOf('sales') * balance.backOffice.sales.rewardWeightPerLevel, arrivalChance: 0 });
    if (clock.paidMonths > before.paidMonths) monthEnd();
    // 日が替わったときの処理
    if (dayOf(clock.minute) > dayOf(before.minute)) {
      const crewUids = new Set(active?.crew ?? []);
      for (const m of devIdleStaffOf(staff, crewUids, hasPc)) clock = applyMoney(clock, devDailyIncome(m, balance), 'dev');
      addExp(dailyOpsGainOf(companyExp, 1, balance));
      const devIdle = new Set(devIdleStaffOf(staff, crewUids, hasPc).map((m) => m.uid));
      staff = staff.map((m) => {
        const exp = dailyExpOfStaff(m, { days: 1, devIdleUids: devIdle, crewUids, hasPc }, balance);
        return exp === null ? m : gainExp(m, exp, balance.staff.expPerLevel);
      });
      // 営業の依頼は、日ごとの確率で届く（プリンターの効果は扱わない）
      const chance = salesArrivalChance(pOf('sales'), balance);
      if (chance > 0) {
        const roll = rand(offers.rng);
        offers = { ...offers, rng: roll.state };
        if (roll.value < chance) offers = salesArrival({ ...offers, minute: clock.minute, companyExp }, offerEnv, pOf('sales') * balance.backOffice.sales.rewardWeightPerLevel);
      }
      if (active?.mode === 'self' && active.finish !== null && dayOf(clock.minute) > active.finish) settle(active);
      if (!active) accept();
    }
  }
  return { rows, bankrupt: clock.bankrupt, minMoney, minFirst1, minFirst3, hiredMonth, hiredSalary, deliveries, earned, earnedFixed, spent, delegated: delegatedCount, selfDesigned: selfCount, stars };
};

const mean = (xs: number[]): number => (xs.length === 0 ? NaN : xs.reduce((s, x) => s + x, 0) / xs.length);
const yen = (n: number): string => `${Math.round(n / 1000).toLocaleString('en-US')}k`;
const seeds = Array.from({ length: trials }, (_, i) => i + 1);

// 遊び方の3段階（技術職だけ）で、序盤の資金の基準を確かめる
const EXPAND_COST = balance.office.expand.baseCost;
const printSkills = (): void => {
  const results = new Map<Skill, RunResult[]>();
  for (const skill of [1, 2, 3] as Skill[]) {
    const scn: Scenario = { id: `skill${skill}`, label: `★${skill}`, hires: [], delegate: false, skill };
    results.set(skill, seeds.map((sd) => run(scn, sd)));
  }
  const at = (rs: RunResult[], m: number): number => mean(rs.map((r) => r.rows[m - 1]?.money ?? NaN));
  const salaryOf = (rs: RunResult[]): number => mean(rs.map((r) => r.rows[0].salary));
  console.log(`
遊び方の3段階（技術職だけ・千円。月給は最初の月末の月給の合計・拡張 ${yen(EXPAND_COST)}）`);
  console.log('  段階  1か月の最低  3か月の最低  1か月末  2か月末  月給  最後の月  倒産');
  for (const skill of [1, 2, 3] as Skill[]) {
    const rs = results.get(skill)!;
    console.log(
      `  ★${skill}  ${yen(Math.min(...rs.map((r) => r.minFirst1))).padStart(10)}  ${yen(Math.min(...rs.map((r) => r.minFirst3))).padStart(10)}  ${yen(at(rs, 1)).padStart(7)}  ${yen(at(rs, 2)).padStart(7)}  ${yen(salaryOf(rs)).padStart(5)}  ${yen(at(rs, months)).padStart(8)}  ${rs.filter((r) => r.bankrupt).length}/${trials}`,
    );
  }
  const r1 = results.get(1)!;
  const r2 = results.get(2)!;
  const r3 = results.get(3)!;
  const pass = (ok: boolean): string => (ok ? '合格' : '不合格');
  console.log(`  ★3の報酬のうち固定案件の割合: ${((mean(r3.map((r) => r.earnedFixed)) / mean(r3.map((r) => r.earned))) * 100).toFixed(0)}%・納品 ${mean(r3.map((r) => r.deliveries)).toFixed(0)} 件`);
  console.log('遊び方の基準');
  const c1 = Math.min(...r1.map((r) => r.minFirst3)) >= salaryOf(r1);
  console.log(`  1. ★1（設計の時間 1.5 倍）でも最初の3か月の資金の最低（0を下回れば倒産）が月給1か月分以上: 最低 ${yen(Math.min(...r1.map((r) => r.minFirst3)))}・月給 ${yen(salaryOf(r1))} → ${pass(c1)}`);
  const c2 = Math.min(...r2.map((r) => r.rows[0].money)) - EXPAND_COST >= salaryOf(r2);
  console.log(`  2. ★2で、1か月目のうちに拡張を買っても月給1か月分が残る: 1か月末の最低 ${yen(Math.min(...r2.map((r) => r.rows[0].money)))} - 拡張 ${yen(EXPAND_COST)} ≥ 月給 ${yen(salaryOf(r2))} → ${pass(c2)}`);
  const hireLine = (rs: RunResult[], m: number): number => 3 * salaryOf(rs) * 1 + 0 * m;
  const c3 = Math.max(at(r3, 1), at(r3, 2)) > hireLine(r3, 2);
  console.log(`  3. ★3で、2か月目までに社員を増やせる（資金が月給の3か月分を超える）: 1か月末 ${yen(at(r3, 1))}・2か月末 ${yen(at(r3, 2))}・3か月分 ${yen(hireLine(r3, 2))} → ${pass(c3)}`);
  const c4 = [r1, r2, r3].every((rs) => Math.min(...rs.map((r) => r.minFirst1)) >= 1.5 * salaryOf(rs));
  console.log(`  4. 最初の1か月は、どの段階でも資金の最低が月給の1.5か月分以上: ${[r1, r2, r3].map((rs, i) => `★${i + 1} ${yen(Math.min(...rs.map((r) => r.minFirst1)))}`).join('・')}（月給の1.5か月分 ${yen(1.5 * salaryOf(r3))}） → ${pass(c4)}`);
  console.log(`  6. ★3の${months}か月後の資金（目安は 7,200k〜9,700k）: ${yen(at(r3, months))}`);
};
if (skillsOnly) {
  printSkills();
  process.exit(0);
}

// 進め方ごとの試行
const runs = new Map<string, RunResult[]>();
const SOLO: Scenario[] = (['sales', 'hr', 'accounting', 'dev'] as JobId[]).map((job) => ({ id: `solo-${job}`, label: `${job} だけ`, hires: [job], delegate: false, skill: 3 }));
for (const scn of [...SCENARIOS, ...SOLO]) runs.set(scn.id, seeds.map((s) => run(scn, s)));

console.log(`試行 ${trials} 回の平均（資金は千円・月給の合計は千円）。月数 ${months}・案件の枠 ${balance.office.projectSlots}・想定の費用は、定型案件が最安の設計の費用・固定案件が予算の ${FIXED_COST_RATIO} 倍`);
for (const scn of SCENARIOS) {
  const rs = runs.get(scn.id)!;
  console.log(`\n${scn.label}`);
  console.log('  月   資金(平均)  資金(最小)  レベル  月給の合計');
  for (let m = 3; m <= months; m += 3) {
    const rows = rs.map((r) => r.rows[m - 1]).filter((r): r is Row => r !== undefined);
    console.log(`  ${String(m).padStart(2)}  ${yen(mean(rows.map((r) => r.money))).padStart(10)}  ${yen(Math.min(...rows.map((r) => r.money))).padStart(10)}  ${mean(rows.map((r) => r.level)).toFixed(1).padStart(6)}  ${yen(mean(rows.map((r) => r.salary))).padStart(10)}`);
  }
}

console.log('\n要約（最後の月）');
console.log('  進め方                              資金(平均)  資金(最小)  レベル  月給  納品  任せた  倒産');
const last = (rs: RunResult[]): Row[] => rs.map((r) => r.rows[months - 1]).filter((r): r is Row => r !== undefined);
for (const scn of SCENARIOS) {
  const rs = runs.get(scn.id)!;
  const rows = last(rs);
  console.log(
    `  ${scn.label.padEnd(30)}  ${yen(mean(rows.map((r) => r.money))).padStart(10)}  ${yen(Math.min(...rows.map((r) => r.money))).padStart(10)}  ${mean(rows.map((r) => r.level)).toFixed(1).padStart(6)}  ${yen(mean(rows.map((r) => r.salary))).padStart(5)}  ${mean(rs.map((r) => r.deliveries)).toFixed(0).padStart(4)}  ${mean(rs.map((r) => r.delegated)).toFixed(0).padStart(5)}  ${rs.filter((r) => r.bankrupt).length}/${trials}`,
  );
}
const e = runs.get('e')!;
console.log('  1か月あたりの依頼の報酬・依頼の費用（千円。内勤の効果の大きさの目安）');
for (const scn of SCENARIOS) {
  const rs = runs.get(scn.id)!;
  console.log(`    ${scn.label.padEnd(30)}  報酬 ${yen(mean(rs.map((r) => r.earned)) / months).padStart(6)}  費用 ${yen(mean(rs.map((r) => r.spent)) / months).padStart(6)}`);
}
console.log(`  (e) の任せた依頼の★: ★1 ${mean(e.map((r) => r.stars.one)).toFixed(0)} 件・★2 ${mean(e.map((r) => r.stars.two)).toFixed(0)} 件（平均）`);

// 合格の基準
console.log('\n合格の基準');
const all = [...SCENARIOS, ...SOLO].flatMap((s) => runs.get(s.id)!);
const minMoney = Math.min(...all.map((r) => r.minMoney));
const bankrupt = all.filter((r) => r.bankrupt).length;
console.log(`1. 資金が0を下回らない: 最小の資金 ${yen(minMoney)}・倒産 ${bankrupt}/${all.length} 回 → ${minMoney >= 0 && bankrupt === 0 ? '合格' : '不合格'}`);

console.log('2. 内勤を1人雇うと、雇った月の3か月後の資金が、雇わなかった場合を下回らず、給与3か月分の 1.5 倍も超えない（給与・机・PC を含めた差）');
const base = runs.get('a')!;
let effectPass = true;
for (const job of ['sales', 'hr', 'accounting', 'dev'] as JobId[]) {
  const rs = runs.get(`solo-${job}`)!;
  const deltas: number[] = [];
  const deltasEnd: number[] = [];
  const salaries: number[] = [];
  let hired = 0;
  rs.forEach((r, i) => {
    const hm = r.hiredMonth[job];
    if (hm === undefined) return;
    hired++;
    const at = hm + 3;
    const withRow = r.rows[at - 1];
    const withoutRow = base[i].rows[at - 1];
    if (withRow && withoutRow) deltas.push(withRow.money - withoutRow.money);
    deltasEnd.push(r.rows[months - 1].money - base[i].rows[months - 1].money);
    salaries.push(r.hiredSalary[job] ?? 0);
  });
  const hireMonths = rs.map((r) => r.hiredMonth[job]).filter((x): x is number => x !== undefined);
  const d = mean(deltas);
  // 下限は雇わない場合を下回らないこと、上限は給与3か月分の 1.5 倍（内勤が得すぎない）
  const ok = deltas.length > 0 && d >= 0 && d <= 1.5 * 3 * mean(salaries);
  if (!ok) effectPass = false;
  console.log(
    `   ${job.padEnd(10)} 雇った ${hired}/${trials} 回（平均 ${mean(hireMonths).toFixed(1)} か月目・月給 ${yen(mean(salaries))}）  3か月後の差 ${yen(d)}（給与3か月分 ${yen(3 * mean(salaries))}）  最後の月の差 ${yen(mean(deltasEnd))}  → ${ok ? '合格' : '不合格'}`,
  );
}
console.log(`   → ${effectPass ? '合格' : '不合格'}`);

const levelAt = (id: string, m: number): number => mean(runs.get(id)!.map((r) => r.rows[m - 1]?.level ?? NaN));
const m12 = Math.min(12, months);
const slower = levelAt('e', months) < levelAt('a', months) && levelAt('e', m12) < levelAt('a', m12);
console.log(`3. 任せる依頼だけの進め方は、自分で設計する進め方よりレベルが遅い: ${m12} か月目 (e) ${levelAt('e', m12).toFixed(1)} / (a) ${levelAt('a', m12).toFixed(1)}・${months} か月目 (e) ${levelAt('e', months).toFixed(1)} / (a) ${levelAt('a', months).toFixed(1)} → ${slower ? '合格' : '不合格'}`);

printSkills();
