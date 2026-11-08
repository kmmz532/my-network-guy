// ゲームの時間を進めるループ。React の外に置き、速さの変化を見て間隔を張り替える。速さ 0（一時停止）のときは止まる。
import { balance } from 'virtual:game-data';
import { useGameStore } from '../stores/useGameStore';

// ループが使うもの。テストでは差し替える
export interface TickLoopDeps {
  game: Pick<typeof useGameStore, 'getState' | 'subscribe'>;
  realMsPerTick: number;
  setInterval: (run: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
}

export function createTickLoop(deps: TickLoopDeps) {
  // 見張りを始める。戻り値で止める
  const watch = (): (() => void) => {
    let id: number | null = null;
    let current: number | null = null;
    const apply = (speed: number) => {
      if (speed === current) return;
      current = speed;
      if (id !== null) deps.clearInterval(id);
      id = speed === 0 ? null : deps.setInterval(() => deps.game.getState().tick(), deps.realMsPerTick / speed);
    };
    apply(deps.game.getState().speed);
    const unsubscribe = deps.game.subscribe((s) => apply(s.speed));
    return () => {
      unsubscribe();
      if (id !== null) deps.clearInterval(id);
      id = null;
      current = null;
    };
  };
  return { watch };
}

export const tickLoop = createTickLoop({
  game: useGameStore,
  realMsPerTick: balance.time.realMsPerTick,
  setInterval: (run, ms) => window.setInterval(run, ms),
  clearInterval: (id) => window.clearInterval(id),
});
