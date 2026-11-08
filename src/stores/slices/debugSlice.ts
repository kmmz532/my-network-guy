// デバッグの操作（お金・レベル・在庫・時刻・案内の進みを既存の仕組みで変える）。
import { balance, guides, levelMilestones } from 'virtual:game-data';
import { expAtLevel, levelOf, levelUpsBetween } from '../../sim/level';
import { applyMoney } from '../../sim/ledger';

import { crewBlock } from '../../sim/crew';
import { accept } from '../../sim/project';

import { coreOf, focusedProject, offerEnv, refresh, unlockItems } from '../gameHelpers';
import type { GameState } from '../useGameStore';
import type { StateCreator } from 'zustand';

export interface DebugSlice {
  setGuideTarget: (uid: string | null) => void;
  // デバッグ（N54）: お金・経験値・レベル・在庫・時刻を、既存の仕組みで変える
  debugAddMoney: (amount: number) => void;
  debugSetCompanyLevel: (level: number) => void;
  debugAddOwned: (device: string, count: number) => void;
  debugSetMinute: (minute: number) => void;
  // 案内を終えた案件として記録する
  markGuideDone: (contractId: string) => void;
  // デバッグ（N54）: 案内の進みを最初に戻す
  debugResetGuides: () => void;
  // デバッグ（N54）: 依頼を今すぐ引き直す（届く時刻を今に合わせ、判定を1回行う）
  debugRefreshOffers: () => void;
  // デバッグ（N54）: 施工中の案件を、時間を進めて最後まで進める（検収の結果が出るまで）
  debugFinishBuild: () => void;
  // デバッグ（N54）: 案内を指定の手順から出す（案件を受注して設計に入る）。受注できないときは理由を返し、何も変えない
  debugStartGuide: (contractId: string, step: number) => string | null;
  // デバッグ（N54）: 案内を終わった扱いにする（経験値は増やさない）
  debugMarkGuideDone: (contractId: string) => void;
  // 案内の開始の指定を、Guide が受け取ったあとに消す
  debugConsumeGuide: () => void;
}

export const createDebugSlice: StateCreator<GameState, [], [], DebugSlice> = (set, get) => {
  return {
    setGuideTarget: (uid) => set({ guideTarget: uid }),
    debugAddMoney: (amount) => set((s) => ({ clock: { ...s.clock, money: s.clock.money + amount } })),
    debugSetCompanyLevel: (level) => {
      const s = get();
      const exp = expAtLevel(level, balance);
      const ups = levelUpsBetween(levelOf(s.companyExp, balance), levelOf(exp, balance), balance, levelMilestones, unlockItems);
      const owned = { ...s.owned };
      for (const u of ups) for (const d of u.devices) owned[d.device] = (owned[d.device] ?? 0) + d.count;
      set({
        companyExp: exp,
        owned,
        clock: applyMoney(s.clock, ups.reduce((sum, u) => sum + u.money, 0), 'reward'),
      });
    },
    debugAddOwned: (device, count) => set((s) => ({ owned: { ...s.owned, [device]: (s.owned[device] ?? 0) + count } })),
    debugSetMinute: (minute) => set((s) => ({ clock: { ...s.clock, minute } })),
    markGuideDone: (contractId) => {
      if (get().guidesDone.includes(contractId)) return;
      set((s) => ({ guidesDone: [...s.guidesDone, contractId] }));
      get().grantCompanyExp('guide');
    },
    debugResetGuides: () => set({ guidesDone: [] }),
    debugRefreshOffers: () => set((s) => refresh({ ...s, nextOfferMinute: s.clock.minute })),
    debugFinishBuild: () => {
      // 施工の進みは時間で決まるため、既存の tick を速い速さで回す（速さは終わったら戻す）
      const before = get().speed;
      set({ speed: 4, nightSpeed: null });
      for (let i = 0; i < 200000 && get().lastReport === null && get().active.some((p) => p.phase === 'build'); i++) get().tick();
      set({ speed: before });
    },
    debugStartGuide: (contractId, step) => {
      const s = get();
      const steps = guides[contractId];
      // 手順の番号（1〜手順の数）と案件を確かめてから動く
      if (!steps || step < 1 || step > steps.length) return 'none';
      const fixed = offerEnv(s.maps).fixed.find((c) => c.id === contractId);
      if (!fixed) return 'none';
      const focused = focusedProject(s);
      if (!(focused && focused.baseId === contractId && focused.phase === 'design')) {
        // 依頼の一覧になければ、この案件の依頼を作る。受注できるかを先に確かめ、できないときは何も変えない
        const existing = s.offers.find((o) => o.kind === 'fixed' && o.baseId === contractId);
        const offer = existing ?? { id: fixed.id, kind: 'fixed' as const, baseId: fixed.id, params: {}, contract: fixed, arrivedMinute: s.clock.minute };
        const offers = existing ? s.offers : [...s.offers, offer];
        // 担当は、空いている社員全員（受注の画面と同じ既定）
        const crew = s.staff.filter((m) => crewBlock(s, m) === null).map((m) => m.uid);
        const probe = accept({ ...coreOf(s), offers }, offer.id, balance.office.projectSlots, crew);
        if (!probe.ok) return probe.reason;
        set({ offers });
        const reason = get().accept(offer.id, crew);
        if (reason) return reason;
      }
      set((st) => ({ guidesDone: st.guidesDone.filter((g) => g !== contractId), debugGuide: { id: contractId, step } }));
      return null;
    },
    debugMarkGuideDone: (contractId) =>
      // 経験値は増やさない（既存の markGuideDone は案内の経験値を入れるため使わない）
      set((st) => (st.guidesDone.includes(contractId) ? {} : { guidesDone: [...st.guidesDone, contractId] })),
    debugConsumeGuide: () => set({ debugGuide: null }),
  };
};
