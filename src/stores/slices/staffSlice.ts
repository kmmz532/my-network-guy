// 社員の採用・昇給・研修などの操作。
import { balance, furniture } from 'virtual:game-data';
import type { FurnitureId } from '../../generated/ids';
import { rand } from '../../sim/rng';
import type { JobId } from '../../data/schema';
import { raiseStaff as raiseStaffOp, staffCapOf } from '../../sim/staff';
import { levelOf } from '../../sim/level';
import { startTraining as startTrainingOp, takeExam as takeExamOp } from '../../sim/training';
import { gameEnv } from '../../sim/env';

import { pushNotice } from '../../ui/notices';
import { tDyn } from '../../i18n/t';
import { cancelRetire as cancelRetireOp, noticeRetire as noticeRetireOp } from '../../sim/retire';
import { backOfficeP } from '../../sim/backOffice';
import { hire as hireOp, bonusEnvOf } from '../../sim/furniture';

import { coreOf, trainingEnv } from '../gameHelpers';
import type { GameState } from '../useGameStore';
import type { StateCreator } from 'zustand';
import { createOps } from '../gameOps';

export interface StaffSlice {
  hire: (candidateUid: string, shift: 'day' | 'night') => string | null;
  // 退職を伝える・取り消す（N90）。伝えられないときは理由の文言の鍵を返す
  noticeRetire: (uid: string) => string | null;
  // 社員の昇給（N101）。上限に達した社員の上限を上げ、給与を次の段階の相場まで上げる
  raiseStaff: (uid: string) => string | null;
  cancelRetire: (uid: string) => string | null;
  // 次の月の募集の職種を指定する（null で指定なし）。人事がいないと指定できない
  setHiringWish: (job: JobId | null) => string | null;
  startTraining: (uid: string, courseId: string) => string | null;
  takeExam: (uid: string, certId: string) => string | null;
}

export const createStaffSlice: StateCreator<GameState, [], [], StaffSlice> = (set, get) => {
  const { apply } = createOps(set, get);
  return {
    setHiringWish: (job) => {
      const s = get();
      const hrP = backOfficeP(s.staff, 'hr', s.office, bonusEnvOf({ staff: s.staff, office: s.office }, gameEnv));
      if (hrP <= 0) return 'ui.error.hr';
      set({ hiringWish: job });
      return null;
    },
    noticeRetire: (uid) => apply(noticeRetireOp(coreOf(get()), uid, balance)),
    raiseStaff: (uid) => apply(raiseStaffOp(coreOf(get()), uid, balance)),
    cancelRetire: (uid) => apply(cancelRetireOp(coreOf(get()), uid)),
    hire: (candidateUid, shift) => {
      const cap = staffCapOf(levelOf(get().companyExp, balance), balance);
      const reason = apply(hireOp(coreOf(get()), candidateUid, (id) => furniture[id as FurnitureId]?.seat === true, cap, shift));
      if (reason === null) {
        get().grantCompanyExp('hire');
        // 採用した社員を知らせる（名前と職種）。上限ちょうどになったら、そのことも知らせる（N97）
        const hired = get().staff[get().staff.length - 1];
        let notices = pushNotice(get().notices, 'hired', { name: tDyn(hired.name), job: tDyn(`staff.job.${hired.job}`), uid: hired.uid }, Date.now());
        if (get().staff.length >= cap) notices = pushNotice(notices, 'capReached', { cap }, Date.now());
        set({ notices });
      }
      return reason;
    },
    startTraining: (uid, courseId) => apply(startTrainingOp(coreOf(get()), uid, courseId, trainingEnv)),
    takeExam: (uid, certId) => {
      // 合否は乱数で決める。乱数は受験のときだけ進める
      const s = get();
      const roll = rand(s.rng);
      const reason = apply(takeExamOp(coreOf(s), uid, certId, roll.value, trainingEnv));
      if (reason === null) set({ rng: roll.state });
      return reason;
    },
  };
};
