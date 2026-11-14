// 依頼・受注・施工の依頼・取り下げの操作。
import { loadSettings, saveSettings } from '../../settings/settings';
import { balance } from 'virtual:game-data';
import { declineOffer } from '../../contracts/offers';
import { gameEnv } from '../../sim/env';

import { OFFICE_HISTORY_KEY, projectHistoryKey } from '../../sim/history';
import { abandon, accept, acceptDelegated as acceptDelegatedOp, delegateBlind as delegateBlindOp, applyBlueprint as applyBlueprintOp, requestBuild } from '../../sim/progress';

import { coreOf, focusedProject } from '../gameHelpers';
import type { GameState } from '../useGameStore';
import type { StateCreator } from 'zustand';
import { createOps } from '../gameOps';

export interface ContractSlice {
  // 確認の答え。mode は 1倍で進める（play）か止めたまま（stay）。remember なら設定に残す
  answerPausedBuild: (mode: 'play' | 'stay', remember: boolean) => void;
  // 案件の流れの操作。失敗したら理由を返す（成功なら null）
  accept: (offerId: string, crew: string[]) => string | null;
  // 設計中の案件に型紙を写す（N70）
  useBlueprint: () => string | null;
  // 型紙なしで任せる（結果は乱数。N94）
  delegateBlind: (offerId: string, crew: string[]) => string | null;
  // 社員に任せて受注する（N70）。任せられない理由は delegationReason で分かる
  acceptDelegated: (offerId: string, crew: string[]) => string | null;
  // まとめて届いた知らせを消す（依頼の一覧を開いたとき）
  clearOfferBurst: () => void;
  // 定型案件の依頼を断る（固定案件は断れない）
  declineOffer: (id: string) => void;
  // 施工を依頼する。時間が止まっていて設定が「確認する」なら、確認を開いて null を返す
  requestBuild: () => string | null;
  abandon: () => string | null;
}

export const createContractSlice: StateCreator<GameState, [], [], ContractSlice> = (set, get) => {
  const { apply, buildNow, dropHistory, recorded } = createOps(set, get);
  return {
    useBlueprint: () => recorded(() => apply(applyBlueprintOp(coreOf(get()), gameEnv))),
    delegateBlind: (offerId, crew) => {
      const s = get();
      const r = delegateBlindOp(coreOf(s), offerId, crew, gameEnv, s.rng, balance.office.projectSlots);
      if (!r.ok) {
        set({ lastError: r.reason });
        return r.reason;
      }
      const reason = apply({ ok: true, core: r.core });
      if (reason === null) set({ rng: r.rng });
      return reason;
    },
    acceptDelegated: (offerId, crew) => {
      const reason = apply(acceptDelegatedOp(coreOf(get()), offerId, balance.office.projectSlots, crew, gameEnv));
      // 型紙で任せた依頼は、利用者が設計しないため時間を止めない（N110）
      return reason;
    },
    accept: (offerId, crew) => {
      const inhouse = get().offers.find((o) => o.id === offerId)?.contract.inhouse === true;
      const reason = apply(accept(coreOf(get()), offerId, balance.office.projectSlots, crew));
      // 自社案件は自社オフィスを引き継ぐ。取り消しで自社オフィスを戻すと引き継いだ内容が壊れるため、自社オフィスの履歴は消す
      if (reason === null && inhouse) dropHistory(OFFICE_HISTORY_KEY);
      // 設定がオンなら、受注して設計に入ったときに時間を止める（配線は時間に追われずに進める）
      if (reason === null && get().speed !== 0 && loadSettings().designPause) get().setSpeed(0);
      return reason;
    },
    clearOfferBurst: () => set({ offerBurst: 0 }),
    declineOffer: (id) => set({ offers: declineOffer(get().offers, id) }),
    requestBuild: () => {
      const s = get();
      // 時間が止まっているときは、設定に従って確認を出すか、速さを決めてから施工を依頼する
      if (s.speed === 0 && requestBuild(coreOf(s), gameEnv).ok) {
        const mode = loadSettings().pausedBuild;
        if (mode === 'ask') {
          set({ pausedPrompt: true });
          return null;
        }
        if (mode === 'play') get().setSpeed(1);
      }
      return buildNow();
    },
    answerPausedBuild: (mode, remember) => {
      set({ pausedPrompt: false });
      if (remember) saveSettings({ pausedBuild: mode });
      if (mode === 'play') get().setSpeed(1);
      buildNow();
    },
    abandon: () => {
      const focusId = focusedProject(get())?.id;
      const reason = apply(abandon(coreOf(get())));
      if (reason === null && focusId) dropHistory(projectHistoryKey(focusId));
      if (reason === null) get().clearTerminalSessions();
      return reason;
    },
  };
};
