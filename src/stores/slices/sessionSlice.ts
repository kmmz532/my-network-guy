// セーブの読み込み・書き出しと、新しい会社・サンドボックスの開始。
import { balance } from 'virtual:game-data';
import { initialClock } from '../../sim/clock';
import type { Offer } from '../../contracts/template';
import { type Company, companyOf } from '../../world/world';
import { resizeSandboxOffice, sandboxClock, sandboxOffice } from '../../sim/sandbox';

import { EMPTY_FAMILIARITY } from '../../sim/familiar';
import { mapOfOffice } from '../../sim/office';
import { OFFICE_HISTORY_KEY } from '../../sim/history';
import { initialOffice } from '../../sim/furniture';
import { type Office, type OfficeSize, noEffects } from '../../sim/project';
import { gameEnv, isPcDevice } from '../../sim/env';
import { pcDesksOf } from '../../sim/furniture';
import { missingPcCount } from '../../sim/backOffice';
import { pushNotice } from '../../ui/notices';
import { dropUnknownDevices } from '../../services/dropUnknown';

import { newRng, newStart, refresh } from '../gameHelpers';
import type { GameState } from '../useGameStore';
import { useUiStore } from '../useUiStore';
import type { StateCreator } from 'zustand';
import { createOps } from '../gameOps';

export interface SessionSlice {
  load: (save: Company) => void;
  snapshot: () => Company;
  // 最初から始める（資金・在庫・依頼などを初期状態に戻す）
  newGame: (name: string) => void;
  // 社名を変える（前後の空白を除く。空なら変えない・N133）
  renameCompany: (name: string) => void;
  // サンドボックスを新しく始める（案件・依頼・社員はなく、時間は止めたまま）
  // サンドボックスを新しく始める（大きさを省くと既定の大きさ）。資金・機器は捨てる
  newSandbox: (size?: OfficeSize) => void;
  // サンドボックスの床の大きさを変える。狭めてはみ出す機器・家具があれば理由を返す
  resizeSandbox: (size: OfficeSize) => string | null;
  // 読み込んだサンドボックスの構成に置き換える（サンドボックスのときだけ）。広げる前の操作の取り消しは消す
  loadSandboxOffice: (office: Office) => string | null;
}

export const createSessionSlice: StateCreator<GameState, [], [], SessionSlice> = (set, get) => {
  const { dropHistory } = createOps(set, get);
  return {
    load: (input) => {
      // 登録にない機材を取り除いてから読む。取り除いたときは知らせる
      const { data: save, count: droppedCount } = dropUnknownDevices(input);
      useUiStore.setState({ wireStart: null, portMenu: null });
      return set(() => {
        const missing = save.mode === 'career'
          ? missingPcCount(save.staff, { pcDesks: pcDesksOf(save.office, isPcDevice), defs: gameEnv.furniture ?? {}, balance: gameEnv.balance, staff: save.staff })
          : 0;
        const pc = missing > 0 ? pushNotice([], 'pcMissing', { count: missing }, Date.now()) : [];
        const notices = droppedCount > 0 ? pushNotice(pc, 'devicesDropped', { count: droppedCount }, Date.now()) : pc;
        return {
        mode: save.mode,
        name: save.name,
        clock: save.clock,
        companyExp: save.companyExp,
        reputation: save.reputation,
        expDay: save.expDay,
        expToday: save.expToday,
        owned: save.owned,
        completed: save.completed,
        deliveries: save.deliveries,
        familiarity: save.familiarity,
        offers: save.offers as Offer[],
        nextOfferMinute: save.nextOfferMinute,
        offerSeq: save.offerSeq,
        newArrivals: save.newArrivals,
        rng: save.rng,
        active: save.active,
        focus: save.focus,
        office: save.office,
        effects: save.effects,
        staff: save.staff,
        staffSeq: save.staffSeq,
        candidates: save.candidates,
        guidesDone: save.guidesDone,
        termsShown: save.termsShown,
        sandboxLesson: save.sandboxLesson,
        maps: { ...get().maps, hq: mapOfOffice(save.office) },
        guideTarget: null,
        lastReport: null,
        showcase: null,
        traces: [],
        check: null,
        helpUid: null,
        histories: {},
        historyError: null,
        windows: [],
        notices,
      };
      });
    },
    renameCompany: (name) => {
      const trimmed = name.trim();
      if (trimmed !== '') set({ name: trimmed });
    },
    newGame: (name) => {
      useUiStore.setState({ wireStart: null, portMenu: null });
      set((s) => {
        const base: Partial<GameState> = {
          mode: 'career',
          name,
          clock: initialClock(balance),
          companyExp: 0,
          reputation: 0,
          expDay: 0,
          expToday: 0,
          owned: { ...balance.initialStock },
          completed: [],
          deliveries: 0,
          familiarity: EMPTY_FAMILIARITY,
          offers: [],
          nextOfferMinute: 0,
          offerSeq: 0,
          newArrivals: {},
          offerBurst: 0,
          ...newStart(),
          candidates: [],
          active: [],
          focus: null,
          office: initialOffice(balance),
          effects: noEffects(),
          guidesDone: [],
          termsShown: [],
          sandboxLesson: null,
          maps: { ...s.maps, hq: mapOfOffice(initialOffice(balance)) },
          guideTarget: null,
          lastReport: null,
          lastError: null,
          traces: [],
          showcase: null,
          check: null,
          helpUid: null,
          histories: {},
          historyError: null,
          windows: [],
          placing: null,
          speed: 1,
          resumeSpeed: 1,
          nightSpeed: null,
          pausedPrompt: false,
        };
        // 新しく始めたら、最初の依頼をすぐ届ける
        return { ...base, ...refresh({ ...s, ...base } as GameState) };
      });
    },
    newSandbox: (size) => {
      useUiStore.setState({ flash: null, wireStart: null, portMenu: null });
      set((s) => {
        const office = sandboxOffice(size);
        return {
          mode: 'sandbox',
          clock: sandboxClock(initialClock(balance)),
          companyExp: 0,
          reputation: 0,
          expDay: 0,
          expToday: 0,
          owned: {},
          completed: [],
          deliveries: 0,
          familiarity: EMPTY_FAMILIARITY,
          offers: [],
          nextOfferMinute: 0,
          offerSeq: 0,
          newArrivals: {},
          offerBurst: 0,
          rng: newRng(),
          staff: [],
          staffSeq: 0,
          candidates: [],
          active: [],
          focus: null,
          office,
          effects: noEffects(),
          guidesDone: [],
          termsShown: [],
          sandboxLesson: null,
          guideTarget: null,
          maps: { ...s.maps, hq: mapOfOffice(office) },
          speed: 0,
          resumeSpeed: 1,
          nightSpeed: null,
          pausedPrompt: false,
          lastReport: null,
          lastError: null,
          notices: [],
          traces: [],
          showcase: null,
          check: null,
          helpUid: null,
          histories: {},
          historyError: null,
          windows: [],
          placing: null,
        };
      });
    },
    resizeSandbox: (size) => {
      if (get().mode !== 'sandbox') return 'none';
      const office = get().office;
      const result = resizeSandboxOffice(office, size);
      if (!result.ok) return result.reason;
      // 床の大きさが変わったので、マップを作り直す。広げる前の操作の取り消しは、座標が合わないため消す
      dropHistory(OFFICE_HISTORY_KEY);
      set({ office: result.office, maps: { ...get().maps, hq: mapOfOffice(result.office) } });
      return null;
    },
    loadSandboxOffice: (office) => {
      if (get().mode !== 'sandbox') return 'none';
      dropHistory(OFFICE_HISTORY_KEY);
      useUiStore.setState({ wireStart: null, portMenu: null });
      set({ office, maps: { ...get().maps, hq: mapOfOffice(office) }, placing: null });
      return null;
    },
    snapshot: () => companyOf(get()),
  };
};
