// ゲーム全体の状態。時間・資金・評判・在庫・完了案件・速度を持ち、Tick ごとに進める。
import { create } from 'zustand';
import { balance, devices } from 'virtual:game-data';
import { advanceTick, initialClock, type ClockState } from '../sim/clock';
import { buyDevice } from '../sim/shop';
import type { SaveData } from '../services/migrations';

export type Speed = 0 | 1 | 2 | 4;

export interface GameState {
  clock: ClockState;
  reputation: number;
  owned: Record<string, number>;
  completed: string[];
  speed: Speed;
  tick: () => void;
  setSpeed: (speed: Speed) => void;
  // 購入に成功したら true
  buy: (deviceId: string) => boolean;
  load: (save: SaveData) => void;
  snapshot: () => SaveData;
}

export const useGameStore = create<GameState>((set, get) => ({
  clock: initialClock(balance),
  reputation: 0,
  owned: {},
  completed: [],
  speed: 1,
  tick: () => set((s) => ({ clock: advanceTick(s.clock, balance) })),
  setSpeed: (speed) => set({ speed }),
  buy: (deviceId) => {
    const s = get();
    const result = buyDevice(s.clock.money, s.owned, deviceId, devices[deviceId as keyof typeof devices].price);
    if (!result.ok) return false;
    set({ clock: { ...s.clock, money: result.money }, owned: result.owned });
    return true;
  },
  load: (save) => set({ clock: save.clock, reputation: save.reputation, owned: save.owned, completed: save.completed }),
  snapshot: () => {
    const s = get();
    return { clock: s.clock, reputation: s.reputation, owned: s.owned, completed: s.completed };
  },
}));
