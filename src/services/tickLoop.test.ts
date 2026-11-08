import { describe, expect, it } from 'vitest';
import { createTickLoop } from './tickLoop';

// 速さと間隔の登録を記録する、偽のゲームと時計
const setup = (initialSpeed: number) => {
  let speed = initialSpeed;
  const listeners: ((s: { speed: number }) => void)[] = [];
  const ticks: number[] = [];
  const timers = new Map<number, { run: () => void; ms: number }>();
  let seq = 0;
  const game = {
    getState: () => ({ speed, tick: () => ticks.push(speed) }),
    subscribe: (l: (s: { speed: number }) => void) => {
      listeners.push(l);
      return () => listeners.splice(listeners.indexOf(l), 1);
    },
  };
  const loop = createTickLoop({
    game: game as never,
    realMsPerTick: 800,
    setInterval: (run, ms) => {
      timers.set(++seq, { run, ms });
      return seq;
    },
    clearInterval: (id) => timers.delete(id),
  });
  const setSpeed = (v: number) => {
    speed = v;
    listeners.forEach((l) => l({ speed }));
  };
  return { loop, setSpeed, timers, ticks };
};

describe('時間を進めるループ', () => {
  it('速さ0のときは間隔を張らない', () => {
    const t = setup(0);
    t.loop.watch();
    expect(t.timers.size).toBe(0);
  });

  it('速さに応じた間隔でティックを進める', () => {
    const t = setup(2);
    t.loop.watch();
    expect([...t.timers.values()].map((x) => x.ms)).toEqual([400]);
    [...t.timers.values()][0].run();
    expect(t.ticks).toEqual([2]);
  });

  it('速さが変わると間隔を張り替え、0で止まる', () => {
    const t = setup(1);
    t.loop.watch();
    t.setSpeed(4);
    expect([...t.timers.values()].map((x) => x.ms)).toEqual([200]);
    t.setSpeed(0);
    expect(t.timers.size).toBe(0);
  });

  it('止めると間隔を外し、以後の速さの変化に反応しない', () => {
    const t = setup(1);
    const stop = t.loop.watch();
    stop();
    expect(t.timers.size).toBe(0);
    t.setSpeed(2);
    expect(t.timers.size).toBe(0);
  });
});
