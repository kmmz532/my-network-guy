// 毎ティックの処理を、順序の決まった系の関数に分けたもの。どの系も状態と引数だけから結果を作り、時刻と設定は TickEnv で受け取る。
// 順序は runTick が持つ: 給与の一時停止 → 時計と収入 → 日ごとの経験値 → 月末 → 研修 → 施工 → 夜の速さ → 依頼と通知。
import { balance } from 'virtual:game-data';
import { advanceTick, minutesPerDay, toDate, type ClockState } from '../sim/clock';
import { minutesPerMonth } from '../sim/clock';
import { isOnShift } from '../sim/shift';
import { nightSpeedStep } from '../sim/nightSpeed';
import type { Staff } from '../data/schema';
import { gainExp, rollCandidates, totalSalary } from '../sim/staff';
import { levelOf } from '../sim/level';
import { finishTrainings } from '../sim/training';
import { gameEnv, isPcDevice } from '../sim/env';
import { rentalOf } from '../network/external';
import { applyMoney } from '../sim/ledger';
import { unlockedSpeedsOf } from '../sim/speed';
import { pushNotice } from '../ui/notices';
import { busyStaff } from '../sim/crew';
import { isDevJob, isFieldEngineerJob, jobOf } from '../sim/jobs';
import { tDyn } from '../i18n/t';
import { settleRetirements } from '../sim/retire';
import { backOfficeP, devDailyIncome, hrCandidateBonus, hrJuniorRate, hrTrainingRate, isBackOffice } from '../sim/backOffice';
import { bonusEnvOf, pcDesksOf } from '../sim/furniture';
import { advanceBuild } from '../sim/project';
import { coreOf, refresh, reportState, salesArrivalPatch, trainingEnv, withLevelUps } from './gameHelpers';
import type { GameState, Speed } from './useGameStore';

// ティックの外から渡す値（現在の時刻と設定）。系の中で Date.now() や loadSettings() を読まない
export interface TickEnv {
  now: number;
  payPause: boolean;
}

type Patch = Partial<GameState>;

// 系1: 給与を払えない月は、給与が払われる直前に一度だけ時間を止める（設定でオフにできる）。止めた後の再開では止めず、そのまま払う
export const payPauseSystem = (s: GameState, env: TickEnv): Patch | null => {
  const payday = (s.clock.paidMonths + 1) * minutesPerMonth(balance);
  if (
    s.speed > 0 &&
    !s.clock.bankrupt &&
    env.payPause &&
    s.payWarned !== s.clock.paidMonths &&
    s.clock.minute + balance.time.gameMinutesPerTick >= payday &&
    s.clock.money < totalSalary(s.staff, balance.nightPayRate)
  ) {
    return { speed: 0, payWarned: s.clock.paidMonths, notices: pushNotice(s.notices, 'payPause', {}, env.now) };
  }
  return null;
};

// 系2の結果: 進んだ時計と、後の系が使う値
export interface ClockStep {
  clock: ClockState;
  // 今回のティックで替わった日数と、給与を払った月の数
  days: number;
  months: number;
  // 貸し出しの評判の減り（月末に漏れがあるとき）
  rentPenalty: boolean;
  crewUids: Set<string>;
  hasPc: (m: Staff) => boolean;
  devIdleUids: Set<string>;
}

// 系2: 時計を進め、貸し出しの収入と開発の収入を受け取る
export const clockSystem = (s: GameState): ClockStep => {
  const ticked = advanceTick(s.clock, balance, totalSalary(s.staff, balance.nightPayRate));
  // 貸し出しの収入（日が替わるたびに、その日の分を受け取る。障害の日は入らない）。月末に漏れがあれば評判が1下がる
  const days = Math.floor(ticked.minute / minutesPerDay) - Math.floor(s.clock.minute / minutesPerDay);
  const months = ticked.paidMonths - s.clock.paidMonths;
  const rent = days > 0 && !ticked.bankrupt && s.mode === 'career' ? rentalOf(s.office, gameEnv.engine, balance.rental, levelOf(s.companyExp, balance), balance.time.daysPerMonth) : null;
  const rentedClock = rent !== null && rent.daily > 0 ? applyMoney(ticked, rent.daily * days, 'rental') : ticked;
  // システムエンジニアは、担当でない日に開発の収入を得る（担当の日は施工の経験値）
  const crewUids = busyStaff(s);
  // 机の上の PC（N102）。システムエンジニア・人事・経理は、自分の机に PC がないと働けない（収入・経験値・効果が出ない）
  const pcDesks = pcDesksOf(s.office, isPcDevice);
  const hasPc = (m: Staff): boolean => m.desk !== null && pcDesks.includes(m.desk);
  const devIdle = days > 0 && s.mode === 'career' ? s.staff.filter((m) => isDevJob(m.job) && m.training === null && !crewUids.has(m.uid) && hasPc(m)) : [];
  const devIncome = devIdle.reduce((sum, m) => sum + devDailyIncome(m, balance) * days, 0);
  const clock = devIncome > 0 ? applyMoney(rentedClock, devIncome, 'dev') : rentedClock;
  return {
    clock,
    days,
    months,
    rentPenalty: rent?.penalty === true && months > 0,
    crewUids,
    hasPc,
    devIdleUids: new Set(devIdle.map((m) => m.uid)),
  };
};

// 系3: 日が替わるたびに、出勤した社員が経験値を得る。社員の列が変わらなければ元の列を返す
// 日ごとの経験値（N102）: 内勤は出勤した日（営業はPCがなくても、人事・経理とシステムエンジニアは PC のある机のみ）。現場のエンジニアは、担当でない日に PC があれば自習で少し
export const dailyExpSystem = (s: GameState, c: ClockStep): Staff[] => {
  const dailyExpOf = (m: Staff): number | null => {
    if (c.devIdleUids.has(m.uid)) return balance.backOffice.dailyExp * c.days;
    if (isBackOffice(m.job)) return m.shift === 'day' && m.training === null && (jobOf(m.job).effect === 'sales' || c.hasPc(m)) ? balance.backOffice.dailyExp * c.days : null;
    if (isFieldEngineerJob(m.job) && m.training === null && !c.crewUids.has(m.uid) && c.hasPc(m)) {
      return balance.backOffice.dailyExp * (jobOf(m.job).pcBonus?.idleExpRate ?? 0) * c.days;
    }
    return null;
  };
  if (!(c.days > 0 && s.mode === 'career')) return s.staff;
  return s.staff.map((m) => {
    const exp = dailyExpOf(m);
    return exp === null ? m : gainExp(m, exp, balance.staff.expPerLevel);
  });
};

// 人事の効果（候補・研修・新人の施工）の大きさ。内勤の実効 level の合計
export const hrPowerOf = (s: GameState): number => backOfficeP(s.staff, 'hr', s.office, bonusEnvOf({ staff: s.staff, office: s.office }, gameEnv));

// 系4: 月末に給与を払ったら、退職の処理・知らせ・採用の候補の作り直しを行う
export const monthEndSystem = (s: GameState, next: Patch, clock: ClockState, hrP: number, env: TickEnv): Patch => {
  if (!(clock.paidMonths > s.clock.paidMonths)) return next;
  const amount = totalSalary(s.staff, balance.nightPayRate);
  // 退職の予定の社員は、今月末で退職する（退職金を払い、一覧から外す。今月の給与は上で払い済み・N90）
  const settled = settleRetirements({ clock: next.clock ?? clock, staff: next.staff ?? s.staff, active: s.active }, balance);
  next = { ...next, clock: settled.clock, staff: settled.staff, active: settled.active };
  // 退職した社員を知らせる（N97）
  for (const m of (next.staff ?? s.staff).length < s.staff.length ? s.staff.filter((x) => x.leaving) : []) {
    next = { ...next, notices: pushNotice(next.notices ?? s.notices, 'retired', { name: tDyn(m.name), uid: m.uid }, env.now) };
  }
  // 毎月1日に、採用の候補を作り直す
  // 募集の職種の指定は、人事がいるときだけ効く。指定は次の1回だけ使う
  const rolled = rollCandidates(levelOf(s.companyExp, balance), clock.paidMonths, s.rng, balance, s.staff.map((m) => m.name), {
    ...hrCandidateBonus(hrP, balance),
    ...(hrP > 0 && s.hiringWish !== null ? { wish: s.hiringWish } : {}),
  });
  return {
    ...next,
    notices: pushNotice(pushNotice(next.notices ?? s.notices, 'salary', { amount }, env.now), 'candidatesRefreshed', {}, env.now),
    candidates: rolled.candidates,
    hiringWish: null,
    rng: rolled.rng,
  };
};

// 系5: 研修の期日が来た社員は、経験値を得て研修を終える
export const trainingSystem = (s: GameState, next: Patch, hrP: number, env: TickEnv): Patch => {
  const trainedStaff = finishTrainings(coreOf({ ...s, ...next } as GameState), trainingEnv, hrTrainingRate(hrP, balance)).staff;
  if (trainedStaff === s.staff) return next;
  next = { ...next, staff: trainedStaff };
  // 研修が終わった社員を知らせる（N97）
  for (const m of trainedStaff) {
    const before = s.staff.find((x) => x.uid === m.uid);
    if (before?.training && !m.training) next = { ...next, notices: pushNotice(next.notices ?? s.notices, 'trained', { name: tDyn(m.name), uid: m.uid }, env.now) };
  }
  return next;
};

// 系6: 施工中なら、勤務時間内に作業を進める
export const buildSystem = (s: GameState, next: Patch, clock: ClockState, hrP: number): Patch => {
  const withClock = { ...s, ...next } as GameState;
  if (clock.bankrupt || !withClock.active.some((p) => p.phase === 'build')) return next;
  const hour = toDate(clock.minute, balance).hour;
  const r = advanceBuild(coreOf(withClock), { ...gameEnv, mapOf: (id) => s.maps[id] }, hour, hrJuniorRate(hrP, balance));
  if (!r.ok) return next;
  return {
    ...next,
    clock: r.core.clock,
    companyExp: r.core.companyExp,
    reputation: r.core.reputation,
    completed: r.core.completed,
    deliveries: r.core.deliveries,
    familiarity: r.core.familiarity,
    active: r.core.active,
    focus: r.core.focus,
    staff: r.core.staff,
    office: r.core.office,
    effects: r.core.effects,
    ...reportState(r.report),
  };
};

// 系7: 勤務時間外に施工中なら最速にし、勤務時間になるか施工が終わったら元の速さへ戻す
// 勤務中の社員が1人もいなければ早送りする（夜勤の社員がいるときは、夜も速さを変えない・N48）
export const nightSpeedSystem = (s: GameState, next: Patch, clock: ClockState): Patch => {
  const activeNow = next.active ?? s.active;
  const minuteOfDay = clock.minute % minutesPerDay;
  const staffNow = next.staff ?? s.staff;
  const night = nightSpeedStep({
    working: staffNow.some((m) => isOnShift(minuteOfDay, m.shift, balance)),
    building: activeNow.some((p) => p.phase === 'build'),
    speed: s.speed,
    saved: s.nightSpeed,
    fastest: Math.max(...unlockedSpeedsOf(levelOf(s.companyExp, balance), balance)),
  });
  if (night.speed === s.speed && night.saved === s.nightSpeed) return next;
  return { ...next, speed: night.speed as Speed, nightSpeed: night.saved as Speed | null };
};

// 系8: 依頼を引き直し、営業の依頼を届け、出来事の通知を出す
export const offersSystem = (s: GameState, next: Patch, days: number, env: TickEnv): Patch => {
  const merged = { ...s, ...next } as GameState;
  const refreshed = refresh(merged);
  // 営業の依頼は、通常の到着のあとに、日ごとの確率で届く
  const salesPatch = salesArrivalPatch({ ...merged, ...refreshed } as GameState, days);
  const result = { ...withLevelUps(s, next), ...refreshed, ...salesPatch };
  // 出来事の通知（N97）: 営業の依頼が届いた（件数をまとめる）・新しい依頼が届いた
  const before = refreshed.offers ?? merged.offers;
  const salesCount = (salesPatch.offers?.length ?? before.length) - before.length;
  const refreshCount = (refreshed.offers?.length ?? merged.offers.length) - merged.offers.length;
  let notices = result.notices ?? s.notices;
  if (salesCount > 0) notices = pushNotice(notices, 'salesArrival', { count: salesCount }, env.now);
  if (refreshCount > 0) notices = pushNotice(notices, 'offersRefreshed', {}, env.now);
  // 上限に達して、昇給を待っている社員（N97・N101）。この時間で上限に達した社員だけ知らせる
  for (const m of result.staff ?? s.staff) {
    const prev = s.staff.find((x) => x.uid === m.uid);
    if (prev && prev.level < prev.levelCap && m.level >= m.levelCap) {
      notices = pushNotice(notices, 'raiseWaiting', { name: tDyn(m.name), uid: m.uid }, env.now);
    }
  }
  return { ...result, notices };
};

// 1ティック分の変更。系を決まった順に並べて呼ぶだけで、状態は書き換えない
export const runTick = (s: GameState, env: TickEnv): Patch => {
  // 納品の結果画面を開いている間は、時間を止める（閉じると、今の速度で続きから進む）
  if (s.showcase) return {};
  const paused = payPauseSystem(s, env);
  if (paused) return paused;
  const step = clockSystem(s);
  const staff = dailyExpSystem(s, step);
  let next: Patch = {
    clock: step.clock,
    ...(step.rentPenalty ? { reputation: Math.max(0, s.reputation - step.months) } : {}),
    ...(staff !== s.staff ? { staff } : {}),
  };
  const hrP = hrPowerOf(s);
  next = monthEndSystem(s, next, step.clock, hrP, env);
  next = trainingSystem(s, next, hrP, env);
  next = buildSystem(s, next, step.clock, hrP);
  next = nightSpeedSystem(s, next, step.clock);
  return offersSystem(s, next, step.days, env);
};
