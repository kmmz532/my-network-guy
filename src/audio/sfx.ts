// 効果音。電子音を Web Audio で合成する（音のファイルは使わない）。設定の「効果音」がオフのときは鳴らさない。
// 音は、ユーザーの操作（クリックなど）の後に鳴るので、ブラウザの自動再生の制限には当たらない。
// 音が出せない環境では何もしない（例外を外へ出さない）。
import { loadSettings } from '../settings/settings';

interface Tone {
  freq: number;
  // 鳴り始め（秒）と長さ（秒）
  at: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  // 終わりの高さ（指定すると、音が滑らかに変わる）
  slideTo?: number;
}

let ctx: AudioContext | null = null;

const context = (): AudioContext | null => {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
};

const play = (tones: Tone[]): void => {
  try {
    if (!loadSettings().sound) return;
    const c = context();
    if (!c) return;
    const t0 = c.currentTime;
    for (const tone of tones) {
      const start = t0 + tone.at;
      const end = start + tone.dur;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = tone.type ?? 'square';
      osc.frequency.setValueAtTime(tone.freq, start);
      if (tone.slideTo) osc.frequency.exponentialRampToValueAtTime(tone.slideTo, end);
      gain.gain.setValueAtTime(tone.gain ?? 0.08, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain).connect(c.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    }
  } catch {
    // 音が出せない環境では何もしない
  }
};

// つながった: 短く高い「ピコッ」
export const playConnect = (): void =>
  play([
    { freq: 660, at: 0, dur: 0.08 },
    { freq: 990, at: 0.07, dur: 0.12 },
  ]);

// 失敗した: 低く下がる「ポン」
export const playFail = (): void => play([{ freq: 220, at: 0, dur: 0.22, type: 'sawtooth', gain: 0.07, slideTo: 110 }]);

// 納品した: 上がる4音のジングル（やや長め）
export const playDeliver = (): void =>
  play([523, 659, 784, 1047].map((freq, i) => ({ freq, at: i * 0.12, dur: 0.22, type: 'triangle' as OscillatorType, gain: 0.1 })));
