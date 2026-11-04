// 固定Tickループ。速度 0（一時停止）のときは止まり、1 / 2 / 4 倍で realMsPerTick ごとに1 Tick 進める。
import { useEffect } from 'react';
import { balance } from 'virtual:game-data';
import { useGameStore } from './useGameStore';

export function useTickLoop(): void {
  const speed = useGameStore((s) => s.speed);
  useEffect(() => {
    if (speed === 0) return;
    const id = window.setInterval(() => {
      useGameStore.getState().tick();
    }, balance.time.realMsPerTick / speed);
    return () => window.clearInterval(id);
  }, [speed]);
}
