// 社員の生成（STAFF.md「1. 社員のデータ」）。名前・見た目・口癖は乱数の状態から選ぶ。能力の計算は後の段階で加える
import type { Balance, JobId, Staff } from '../data/schema';
import { JOB_IDS, STAFF_LOOKS } from '../data/schema';
import type { Office } from './project';
import { furnitureBonus, seatOf, type BonusEnv } from './furniture';
import { randInt } from './rng';

// 名前の候補（言語ファイルの staff.name.0 〜 staff.name.29）の数
export const NAME_COUNT = 30;
// 口癖の候補（言語ファイルの staff.quirk.<id>）
export const QUIRK_IDS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8'] as const;

export interface StaffSpec {
  job: JobId;
  level: number;
  salary: number;
}

// 社員を1人作る。rng は乱数の状態で、更新後の状態も返す。seq は uid の連番（"s" + seq）
export const createStaff = (spec: StaffSpec, rng: number, seq: number): { staff: Staff; rng: number } => {
  const name = randInt(rng, 0, NAME_COUNT - 1);
  const look = randInt(name.state, 0, STAFF_LOOKS.length - 1);
  const quirk = randInt(look.state, 0, QUIRK_IDS.length - 1);
  const staff: Staff = {
    uid: `s${seq}`,
    name: `staff.name.${name.value}`,
    look: STAFF_LOOKS[look.value],
    quirk: QUIRK_IDS[quirk.value],
    job: spec.job,
    level: spec.level,
    exp: 0,
    salary: spec.salary,
    certs: [],
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
    const made = createStaff(specAt(balance, i), state, i);
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
export const totalSalary = (staff: readonly Staff[]): number => staff.reduce((sum, s) => sum + s.salary, 0);

// 採用の候補を毎月作り直す（0人〜maxCandidates人）。level は評判と乱数で決まり、月給は level で決まる
// 候補の uid は "c" + 月 + "_" + 順番。採用するときに社員の uid へ付け替える
export const rollCandidates = (
  reputation: number,
  month: number,
  rng: number,
  balance: Balance,
): { candidates: Staff[]; rng: number } => {
  const h = balance.hiring;
  const count = randInt(rng, 0, h.maxCandidates);
  let state = count.state;
  const candidates: Staff[] = [];
  for (let i = 0; i < count.value; i++) {
    const bonus = randInt(state, 0, 1);
    const job = randInt(bonus.state, 0, JOB_IDS.length - 1);
    const level = 1 + Math.floor(reputation / h.reputationPerLevel) + bonus.value;
    const made = createStaff(
      { job: JOB_IDS[job.value], level, salary: h.baseSalary + h.salaryPerLevel * level },
      job.state,
      0,
    );
    state = made.rng;
    candidates.push({ ...made.staff, uid: `c${month}_${i}` });
  }
  return { candidates, rng: state };
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
