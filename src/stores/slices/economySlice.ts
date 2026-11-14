// 速さの変更・購入・売却・経験値の付与の操作。
import { balance, levelMilestones } from 'virtual:game-data';
import { levelOf, levelUpsBetween } from '../../sim/level';
import { grantDailyExp, type ExpSource } from '../../sim/companyExp';
import { applyMoney } from '../../sim/ledger';

import { assertKnownSpeed, isSpeedUnlocked } from '../../sim/speed';

import { unlockItems } from '../gameHelpers';
import { priceOfItem } from '../../world/price';
import { createOps } from '../gameOps';
import type { GameState, Speed } from '../useGameStore';
import type { StateCreator } from 'zustand';

export interface EconomySlice {
  // 納品以外の経験値（案内・採用・拡張・家具。1日の上限あり。N55）
  grantCompanyExp: (source: ExpSource) => void;
  setSpeed: (speed: Speed) => void;
  // 購入に成功したら true
  buy: (deviceId: string) => boolean;
  // 在庫を1台売ったら true（サンドボックスでは売らない）
  sell: (deviceId: string) => boolean;
}

export const createEconomySlice: StateCreator<GameState, [], [], EconomySlice> = (set, get) => {
  const { applyUnrecorded } = createOps(set, get);
  return {
    grantCompanyExp: (source) => {
      const s = get();
      // サンドボックスは育成がないため、経験値は入れない
      if (s.mode === 'sandbox') return;
      const r = grantDailyExp(s, source, s.clock.minute, balance);
      if (r.gained === 0) return;
      // 納品と同じく、上がったレベルの報酬（お金・機器）を受け取る
      const ups = levelUpsBetween(levelOf(s.companyExp, balance), levelOf(r.companyExp, balance), balance, levelMilestones, unlockItems);
      const owned = { ...s.owned };
      for (const u of ups) for (const d of u.devices) owned[d.device] = (owned[d.device] ?? 0) + d.count;
      set({
        companyExp: r.companyExp,
        expDay: r.expDay,
        expToday: r.expToday,
        owned,
        clock: applyMoney(s.clock, ups.reduce((sum, u) => sum + u.money, 0), 'reward'),
      });
    },
    // 速さを人が変えたら、勤務時間外の自動の早送りは取り消す（覚えた速さには戻さない）
    // サンドボックスは時間を止めたままにする
    setSpeed: (speed) => {
      assertKnownSpeed(speed, balance);
      // 解放されていない早送りには変えない（N99）。サンドボックスは従来どおり止めたまま
      if (get().mode !== 'sandbox' && !isSpeedUnlocked(speed, levelOf(get().companyExp, balance), balance)) return;
      set({ speed: get().mode === 'sandbox' ? 0 : speed, nightSpeed: null, ...(speed !== 0 && get().mode !== 'sandbox' ? { resumeSpeed: speed } : {}) });
    },
    // 購入・売却は取り消しの履歴に積まない（applyUnrecorded）。定価の分からないIDは買えない・売れない（黙って0円にしない）
    buy: (deviceId) => {
      if (priceOfItem(deviceId) === undefined) return false;
      return applyUnrecorded({ kind: 'buy', id: deviceId }) === null;
    },
    sell: (deviceId) => {
      if (priceOfItem(deviceId) === undefined) return false;
      return applyUnrecorded({ kind: 'sell', id: deviceId }) === null;
    },
  };
};
