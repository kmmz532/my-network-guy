// 社員の生成（STAFF.md「1. 社員のデータ」）。名前・見た目・口癖は乱数の状態から選ぶ。能力の計算は後の段階で加える
import type { Balance, JobId, Staff } from '../data/schema';
import { STAFF_LOOKS } from '../data/schema';
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

// 人数の順番（0始まり）に対応する初期の社員の設定。1人目と2人目は staff.initial、3人目以降は network・level 1・月給 monthlySalary
export const specAt = (balance: Balance, index: number): StaffSpec => {
  const initial = balance.staff.initial[index];
  if (initial) return { job: initial.job, level: initial.level, salary: initial.salary };
  return { job: 'network', level: 1, salary: balance.staff.monthlySalary };
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
