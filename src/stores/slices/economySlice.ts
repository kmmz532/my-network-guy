// 速さの変更・購入・売却・経験値の付与の操作。
import { balance, levelMilestones } from 'virtual:game-data';
import { buyDevice, sellDevice } from '../../sim/shop';
import { levelOf, levelUpsBetween } from '../../sim/level';
import { grantDailyExp, type ExpSource } from '../../sim/companyExp';
import { applyMoney, recordSaving } from '../../sim/ledger';

import { isSpeedUnlocked } from '../../sim/speed';

import { priceOfItem, purchaseDiscountOf, unlockItems } from '../gameHelpers';
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
      // 解放されていない早送りには変えない（N99）。サンドボックスは従来どおり止めたまま
      if (get().mode !== 'sandbox' && !isSpeedUnlocked(speed, levelOf(get().companyExp, balance), balance)) return;
      set({ speed: get().mode === 'sandbox' ? 0 : (speed as Speed), nightSpeed: null });
    },
    buy: (deviceId) => {
      const s = get();
      // 機材・家具の定価。どちらにもないIDは買えない（黙って0円にしない）
      const listPrice = priceOfItem(deviceId);
      if (listPrice === undefined) return false;
      // サンドボックスは購入の費用を 0 とする（在庫は増える）
      const price = s.mode === 'sandbox' ? 0 : Math.round(listPrice * (1 - purchaseDiscountOf(s)));
      const result = buyDevice(s.clock.money, s.owned, deviceId, price);
      if (!result.ok) return false;
      // 購入は費用に入れない。案件の費用は納品のときに、置かれている機器の定価と配線の費用から決める
      // 割引で浮いた額は、節約として帳簿に残す（資金は変えない）
      set({ clock: recordSaving(applyMoney(s.clock, result.money - s.clock.money, 'purchase'), s.mode === 'sandbox' ? 0 : listPrice - price), owned: result.owned });
      return true;
    },
    sell: (deviceId) => {
      const s = get();
      if (s.mode === 'sandbox') return false;
      const price = priceOfItem(deviceId);
      if (price === undefined) return false;
      const result = sellDevice(s.clock.money, s.owned, deviceId, price, balance.sellRate);
      if (!result.ok) return false;
      set({ clock: applyMoney(s.clock, result.money - s.clock.money, 'sale'), owned: result.owned });
      return true;
    },
  };
};
