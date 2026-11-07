// 社員の生成（STAFF.md「1. 社員のデータ」）。名前・見た目・口癖は乱数の状態から選ぶ。能力の計算は後の段階で加える
import type { Balance, JobId, Staff } from '../data/schema';
import { JOB_IDS, STAFF_LOOKS } from '../data/schema';
import type { Office, Project } from './project';
import { minutesPerDay } from './clock';
import { furnitureBonus, seatOf, type BonusEnv } from './furniture';
import { randInt } from './rng';

// 名前の候補（言語ファイルの staff.name.0 〜 staff.name.59）の数
export const NAME_COUNT = 91;
// 口癖の候補（言語ファイルの staff.quirk.<id>）
export const QUIRK_IDS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10', 'q11', 'q12'] as const;

export interface StaffSpec {
  job: JobId;
  level: number;
  salary: number;
}

// 名前を1つ選ぶ。taken（在籍中の社員と、同じ回に作る候補の名前）と重ならない名前から選ぶ。
// 使っていない名前がなくなったときだけ、重なりを許して全体から選ぶ
export const pickName = (rng: number, taken: readonly string[]): { name: string; rng: number } => {
  const used = new Set(taken);
  const free: number[] = [];
  for (let i = 0; i < NAME_COUNT; i++) if (!used.has(`staff.name.${i}`)) free.push(i);
  const pool = free.length > 0 ? free : Array.from({ length: NAME_COUNT }, (_, i) => i);
  const pick = randInt(rng, 0, pool.length - 1);
  return { name: `staff.name.${pool[pick.value]}`, rng: pick.state };
};

// 社員を1人作る。rng は乱数の状態で、更新後の状態も返す。seq は uid の連番（"s" + seq）。taken は重ねたくない名前（言語ファイルのキー）
export const createStaff = (spec: StaffSpec, rng: number, seq: number, taken: readonly string[] = []): { staff: Staff; rng: number } => {
  const picked = pickName(rng, taken);
  const look = randInt(picked.rng, 0, STAFF_LOOKS.length - 1);
  const quirk = randInt(look.state, 0, QUIRK_IDS.length - 1);
  const staff: Staff = {
    uid: `s${seq}`,
    shift: 'day',
    name: picked.name,
    look: STAFF_LOOKS[look.value],
    quirk: QUIRK_IDS[quirk.value],
    job: spec.job,
    level: spec.level,
    exp: 0,
    salary: spec.salary,
    certs: [],
    hiredMonth: 0,
    leaving: false,
    training: null,
  };
  return { staff, rng: quirk.state };
};

// 人数の順番（0始まり）に対応する社員の設定。1人目と2人目は staff.initial、3人目以降は network・level 1・月給は初期の1人目と同じ
export const specAt = (balance: Balance, index: number): StaffSpec => {
  const initial = balance.staff.initial[index];
  if (initial) return { job: initial.job, level: initial.level, salary: initial.salary };
  return { job: 'network', level: 1, salary: balance.staff.initial[0].salary };
};

// 新しいゲームの初期の社員（staff.initial の順）
export const initialStaff = (balance: Balance, rng: number): { staff: Staff[]; staffSeq: number; rng: number } => {
  let state = rng;
  const staff: Staff[] = [];
  balance.staff.initial.forEach((_, i) => {
    const made = createStaff(specAt(balance, i), state, i, staff.map((s) => s.name));
    state = made.rng;
    staff.push(made.staff);
  });
  return { staff, staffSeq: staff.length, rng: state };
};

// 社員の施工力 = level × 職種の係数 × 席の係数 × (1 + 家具の施工力)。requires は案件の求める職種（なければ undefined）
export const staffPower = (staff: Staff, requires: readonly JobId[] | undefined, office: Office, env: BonusEnv): number => {
  const jobFactor = requires?.includes(staff.job) ? env.balance.staff.power.jobMatch : 1;
  const bonus = furnitureBonus(office, staff.uid, env);
  const seated = seatOf(office, env.staffUids, staff.uid, env.defs) !== null;
  const seatFactor = seated ? 1 : bonus.seatless;
  return staff.level * jobFactor * seatFactor * (1 + bonus.power);
};

// 経験値を与える。expPerLevel × level に達したら level を上げ、余りは繰り越す
export const gainExp = (staff: Staff, amount: number, expPerLevel: number): Staff => {
  let level = staff.level;
  let exp = staff.exp + amount;
  while (exp >= expPerLevel * level) {
    exp -= expPerLevel * level;
    level++;
  }
  return { ...staff, level, exp };
};

// 月給の合計（全社員の salary）
// 夜勤の給与は、日勤の給与に nightPayRate を掛けた額（N48）
export const totalSalary = (staff: readonly Staff[], nightPayRate: number): number =>
  staff.reduce((sum, s) => sum + (s.shift === 'night' ? s.salary * nightPayRate : s.salary), 0);

// 採用の候補を毎月作り直す（0人〜maxCandidates人）。level は評判と乱数で決まり、月給は level で決まる
// 候補の uid は "c" + 月 + "_" + 順番。採用するときに社員の uid へ付け替える。
// taken は在籍中の社員の名前。候補どうしも名前が重ならない
// 会社のレベルで解放された職種（採用の候補に出る職種）
export const unlockedJobsOf = (companyLevel: number, balance: Balance): JobId[] =>
  JOB_IDS.filter((j) => balance.hiring.jobUnlockLevels[j] <= companyLevel);

// 社員の人数の上限（会社のレベル以上での上限のうち、最も新しいもの）。どの上限にも届かないレベルは 0
export const staffCapOf = (companyLevel: number, balance: Balance): number => {
  let cap = 0;
  for (const [lvl, max] of balance.hiring.staffCapByLevel) if (companyLevel >= lvl) cap = max;
  return cap;
};

// 候補を作る。職種は、会社のレベルで解放された職種から選ぶ。候補の能力は会社のレベルで上がる（LEVEL.md 3.3）
// hr は人事の効果（候補の数を増やす・候補の能力を上げる。どちらも既定は 0）
export const rollCandidates = (
  companyLevel: number,
  month: number,
  rng: number,
  balance: Balance,
  taken: readonly string[] = [],
  hr: { extraCount: number; levelBonus: number; wish?: JobId } = { extraCount: 0, levelBonus: 0 },
): { candidates: Staff[]; rng: number } => {
  const h = balance.hiring;
  const jobs = unlockedJobsOf(companyLevel, balance);
  // 解放された職種がなければ、候補は出ない（Lv1 では採用の画面は開けない）
  if (jobs.length === 0) return { candidates: [], rng };
  const count = randInt(rng, 0, h.maxCandidates + hr.extraCount);
  let state = count.state;
  const candidates: Staff[] = [];
  const names = [...taken];
  for (let i = 0; i < count.value; i++) {
    const bonus = randInt(state, 0, 1);
    // 募集の職種の指定（人事）: 候補の半分以上（切り上げ）は、指定した職種にする
    const wishIndex = hr.wish !== undefined ? jobs.indexOf(hr.wish) : -1;
    const job = wishIndex >= 0 && i < Math.ceil(count.value / 2) ? { value: wishIndex, state: bonus.state } : randInt(bonus.state, 0, jobs.length - 1);
    const level = 1 + Math.floor(companyLevel / h.candidateLevelStep) + bonus.value + hr.levelBonus;
    const made = createStaff(
      { job: jobs[job.value], level, salary: h.baseSalary + h.salaryPerLevel * level },
      job.state,
      0,
      names,
    );
    state = made.rng;
    names.push(made.staff.name);
    candidates.push({ ...made.staff, uid: `c${month}_${i}` });
  }
  return { candidates, rng: state };
};

// 社員の状態（札と一覧に出す）。研修中、担当中（案件の名前）、待機中の順に決まる
export type StaffStatus =
  | { kind: 'training'; days: number }
  | { kind: 'project'; baseId: string; params: Project['params'] }
  | { kind: 'idle' };

// 研修の残りは、今の時刻から期日までの日数（1日未満は1日と数える）
export const staffStatus = (staff: Staff, active: readonly Project[], minute: number): StaffStatus => {
  if (staff.training) {
    const days = Math.max(1, Math.ceil((staff.training.untilMinute - minute) / minutesPerDay));
    return { kind: 'training', days };
  }
  const project = active.find((p) => p.crew.includes(staff.uid));
  if (project) return { kind: 'project', baseId: project.baseId, params: project.params };
  return { kind: 'idle' };
};

// ヒントの段階（1〜3）。担当のうち案件の職種と一致する者の最高 level（いなければ担当全体の最高 level）で決まる。
// hintLevels は段階2・3の境目の level（先頭の段階1は level が何であっても最低の段階）
export const hintTier = (crew: readonly Staff[], jobs: readonly JobId[] | undefined, hintLevels: readonly number[]): 1 | 2 | 3 => {
  const matched = jobs ? crew.filter((s) => jobs.includes(s.job)) : [];
  const pool = matched.length > 0 ? matched : crew;
  const level = pool.reduce((max, s) => Math.max(max, s.level), 0);
  let tier: 1 | 2 | 3 = 1;
  if (level >= hintLevels[1]) tier = 2;
  if (level >= hintLevels[2]) tier = 3;
  return tier;
};
