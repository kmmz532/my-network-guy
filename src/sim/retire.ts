// 社員の退職（N90）。退職を伝えると、その月の末日に退職する。判定と月末の処理は純粋な関数。
// 退職の予定の社員は、月末までは通常どおり働く。新しい案件の担当と研修には選べない（担当の選択・研修の開始で止める）。
import type { Balance, Staff } from '../data/schema';
import { ENGINEER_JOB_IDS } from '../data/schema';
import type { ClockState } from './clock';
import { fail, type Core, type Outcome, type Project } from './project';
import { applyMoney } from './ledger';

// 判定と月末の処理に使う部分（ゲームの状態のうち、社員・案件・時計）
interface RetireState {
  clock: ClockState;
  staff: Staff[];
  active: Project[];
}


// 退職を伝えられない理由（ui.error.<理由> の文言）。伝えられるなら null
export const retireBlock = (state: RetireState, uid: string, balance: Balance): string | null => {
  const member = state.staff.find((s) => s.uid === uid);
  if (!member) return 'none';
  if (member.leaving) return 'retire.already';
  // 採用から一定の月数がたつまで、伝えられない（初めの社員も同じ。採用の月は0）
  if (state.clock.paidMonths - member.hiredMonth < balance.retire.minMonths) return 'retire.tooSoon';
  // 1か月に1人まで。退職の予定の社員がいれば、今月すでに伝えている（予定は月末に消えるため）
  if (state.staff.some((s) => s.leaving)) return 'retire.already';
  // 退職するとエンジニア枠が0人になる場合は伝えられない（案件を受けられなくなるため）
  const engineersLeft = state.staff.filter((s) => s.uid !== uid && !s.leaving && (ENGINEER_JOB_IDS as readonly string[]).includes(s.job)).length;
  if (engineersLeft === 0) return 'retire.noEngineer';
  // 受注中の案件の担当がこの社員だけなら伝えられない（月末に担当が0人になり、案件が止まるため）
  if (state.active.some((p) => p.crew.length === 1 && p.crew[0] === uid)) return 'retire.soleCrew';
  return null;
};

// 退職を伝える（その月の末日に退職する）
export const noticeRetire = (core: Core, uid: string, balance: Balance): Outcome => {
  const reason = retireBlock(core, uid, balance);
  if (reason !== null) return fail(reason);
  return { ok: true, core: { ...core, staff: core.staff.map((s) => (s.uid === uid ? { ...s, leaving: true } : s)) } };
};

// 退職の予定を取り消す（月末までは費用なしで取り消せる）
export const cancelRetire = (core: Core, uid: string): Outcome => {
  const member = core.staff.find((s) => s.uid === uid);
  if (!member) return fail('none');
  if (!member.leaving) return { ok: true, core };
  return { ok: true, core: { ...core, staff: core.staff.map((s) => (s.uid === uid ? { ...s, leaving: false } : s)) } };
};

// 月末の処理。退職の予定の社員に退職金（月給 × payMonths）を払い、社員の一覧から外す。
// 受注中の案件の担当からも外す（その案件は担当が減る）。退職の月の給与は、呼び出し元の給与の処理で払い済み
export const settleRetirements = <T extends RetireState>(state: T, balance: Balance): T => {
  const leavers = state.staff.filter((s) => s.leaving);
  if (leavers.length === 0) return state;
  const gone = new Set(leavers.map((s) => s.uid));
  const clock = leavers.reduce((c, m) => applyMoney(c, -m.salary * balance.retire.payMonths, 'retirement'), state.clock);
  const active = state.active.map((p) => (p.crew.some((uid) => gone.has(uid)) ? { ...p, crew: p.crew.filter((uid) => !gone.has(uid)) } : p));
  return { ...state, clock, staff: state.staff.filter((s) => !s.leaving), active };
};
