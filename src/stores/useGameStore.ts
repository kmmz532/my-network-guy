// ゲーム全体の状態。時間・資金・評判・速度を持ち、Tick ごとに進める。
import { create } from 'zustand';
import { balance } from 'virtual:game-data';
import { advanceTick, initialClock, type ClockState } from '../sim/clock';

export type Speed = 0 | 1 | 2 | 4;

export interface GameState {
  clock: ClockState;
  reputation: number;
  speed: Speed;
  tick: () => void;
  setSpeed: (speed: Speed) => void;
  load: (state: Pick<GameState, 'clock' | 'reputation'>) => void;
  addMoney: (amount: number) => void;
  addReputation: (amount: number) => void;
}

export const useGameStore = create<GameState>((set) => ({
  clock: initialClock(balance),
  reputation: 0,
  speed: 1,
  tick: () => set((s) => ({ clock: advanceTick(s.clock, balance) })),
  setSpeed: (speed) => set({ speed }),
  load: (state) => set({ clock: state.clock, reputation: state.reputation }),
  addMoney: (amount) => set((s) => ({ clock: { ...s.clock, money: s.clock.money + amount } })),
  addReputation: (amount) => set((s) => ({ reputation: s.reputation + amount })),
}));
