// 効果音（WAV）を合成して生成する。外部の音源や素材は使わない。
// 使い方: node scripts/gen-sfx.mjs [シード]
// 出力先: public/sfx/（connect-N.wav, fail-N.wav, deliver-N.wav）
// シードを変えると、同じ設計のまま別の揺らぎの音源になる。省略時は固定のシード（再生成しても同じ音になる）。
//
// 設計の方針:
//   - 接続: ケーブルを差し込むときの接触音（短いノイズ）と、機器の樹脂の共鳴、通信の立ち上がりを表す 3 音（FSK 風）。
//   - 失敗: 低い衝撃と、少しずらした 2 つの矩形波のうなり（ブー）。
//   - 納品: FM（位相変調）で作ったベル音を、和音の組み立てで 4 音鳴らし、最後に余韻を重ねる。
// 各バリエーションは、シードから音程・長さ・音階を決める。同じ設計でも毎回ちがう音になる。

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 44100;
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sfx');
const seedArg = process.argv[2] ?? 'network-ya';

// シードから乱数（0 以上 1 未満）を作る（mulberry32）。文字列のシードは数値に変換する。
const makeRng = (seedText) => {
  let s = 0;
  for (const ch of seedText) s = (Math.imul(s, 31) + ch.charCodeAt(0)) | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// 範囲内の乱数
const range = (rng, min, max) => min + (max - min) * rng();

// 1 つの音（音程のある波形）を作る。f0 から f1 へ直線的に変える。
// fm を指定すると位相変調をかける（ベル音の金属的な倍音）。
const tone = ({ len, f0, f1 = f0, wave = 'sine', fm = null }) => {
  const out = new Float32Array(len);
  let phase = 0;
  let phaseM = 0;
  for (let i = 0; i < len; i++) {
    const f = f0 + ((f1 - f0) * i) / len;
    phase += (2 * Math.PI * f) / SR;
    let v;
    if (wave === 'square') v = Math.sign(Math.sin(phase));
    else if (wave === 'tri') v = (2 / Math.PI) * Math.asin(Math.sin(phase));
    else v = Math.sin(phase + (fm ? fm.index(i / SR) * Math.sin(phaseM) : 0));
    if (fm) phaseM += (2 * Math.PI * f * fm.ratio) / SR;
    out[i] = v;
  }
  return out;
};

const noise = (len, rng) => {
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = rng() * 2 - 1;
  return out;
};

// 1 次の低域フィルタ（角を丸くする）
const lowpass = (a, fc) => {
  const k = 1 - Math.exp((-2 * Math.PI * fc) / SR);
  let y = 0;
  for (let i = 0; i < a.length; i++) {
    y += k * (a[i] - y);
    a[i] = y;
  }
  return a;
};

// 帯域通過（RBJ の biquad）。ノイズの色を決める。
const bandpass = (a, fc, q) => {
  const w = (2 * Math.PI * fc) / SR;
  const alpha = Math.sin(w) / (2 * q);
  const b0 = alpha;
  const b2 = -alpha;
  const a0 = 1 + alpha;
  const a1 = -2 * Math.cos(w);
  const a2 = 1 - alpha;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    a[i] = y;
  }
  return a;
};

// 減衰（指数）と立ち上がり、終わりのフェードアウト（クリックを防ぐ）
const envelope = (a, { attack = 0.002, tau = 0.05 }) => {
  const fade = Math.floor(SR * 0.004);
  for (let i = 0; i < a.length; i++) {
    const t = i / SR;
    let g = Math.min(1, t / attack) * Math.exp(-t / tau);
    if (i > a.length - fade) g *= (a.length - i) / fade;
    a[i] *= g;
  }
  return a;
};

// 出力用のバッファに、ある時刻から音を重ねる
const mix = (master, a, at, gain = 1) => {
  const start = Math.floor(at * SR);
  for (let i = 0; i < a.length && start + i < master.length; i++) master[start + i] += a[i] * gain;
};

// 音量をそろえる（ピークを 0.7 にする）
const normalize = (master) => {
  let peak = 0;
  for (const v of master) peak = Math.max(peak, Math.abs(v));
  if (peak === 0) return master;
  const k = 0.7 / peak;
  for (let i = 0; i < master.length; i++) master[i] *= k;
  return master;
};

// 16 ビット・モノラルの WAV にする
const toWav = (samples) => {
  const data = Buffer.alloc(44 + samples.length * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + samples.length * 2, 4);
  data.write('WAVE', 8);
  data.write('fmt ', 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(SR, 24);
  data.writeUInt32LE(SR * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return data;
};

// つながった: 接触音（ノイズ）、樹脂の共鳴（音程が少し下がる）、通信の立ち上がり（FSK 風の 3 音）
const makeConnect = (rng) => {
  const master = new Float32Array(Math.floor(SR * 0.3));
  const click = envelope(bandpass(noise(Math.floor(SR * 0.03), rng), range(rng, 2200, 3400), range(rng, 3, 6)), { tau: 0.004 });
  mix(master, click, 0, 0.7);
  const body = envelope(tone({ len: Math.floor(SR * 0.08), f0: range(rng, 1200, 1600), f1: range(rng, 850, 1000) }), { tau: 0.018 });
  mix(master, body, 0.004, 0.35);
  // FSK 風: 低い音と高い音を交互に鳴らす（昔のモデムの通信音の名残）
  const low = range(rng, 1100, 1300);
  const high = range(rng, 2000, 2300);
  [low, high, low].forEach((f, i) => {
    const s = envelope(tone({ len: Math.floor(SR * 0.03), f0: f }), { attack: 0.002, tau: 0.02 });
    mix(master, s, 0.05 + i * 0.03, 0.22);
  });
  return normalize(master);
};

// 失敗した: 低い衝撃、少しずらした矩形波のうなり（ブー）、短いノイズの「ガッ」
const makeFail = (rng) => {
  const master = new Float32Array(Math.floor(SR * 0.4));
  const thump = envelope(tone({ len: Math.floor(SR * 0.15), f0: range(rng, 100, 130), f1: range(rng, 45, 60) }), { tau: 0.05 });
  mix(master, thump, 0, 0.7);
  const base = range(rng, 150, 170);
  const beat = base * (1 + range(rng, 0.025, 0.04));
  const dur = Math.floor(SR * 0.3);
  mix(master, envelope(lowpass(tone({ len: dur, f0: base, wave: 'square' }), 800), { attack: 0.005, tau: 0.12 }), 0, 0.18);
  mix(master, envelope(lowpass(tone({ len: dur, f0: beat, wave: 'square' }), 800), { attack: 0.005, tau: 0.12 }), 0, 0.18);
  const grit = envelope(bandpass(noise(Math.floor(SR * 0.05), rng), 350, 1.5), { tau: 0.02 });
  mix(master, grit, 0, 0.3);
  return normalize(master);
};

// 納品した: FM のベル音を 4 音、最後に和音と余韻を重ねる。音階は 3 種類から選ぶ。
const SCALES = [
  [659, 880, 1047, 1319], // 長調寄り
  [587, 698, 880, 1047], // 短調寄り
  [523, 659, 784, 988], // 浮いた響き
];

const makeDeliver = (rng) => {
  const master = new Float32Array(Math.floor(SR * 0.85));
  const scale = SCALES[Math.floor(rng() * SCALES.length)];
  const ratio = range(rng, 2.8, 3.6);
  const index0 = range(rng, 2.5, 4);
  const gap = range(rng, 0.075, 0.095);
  scale.forEach((f, i) => {
    const bell = envelope(
      tone({ len: Math.floor(SR * 0.22), f0: f, fm: { ratio, index: (t) => index0 * Math.exp(-t / 0.05) } }),
      { tau: 0.13 },
    );
    mix(master, bell, i * gap, 0.3);
  });
  const end = scale.length * gap;
  const top = scale[scale.length - 1];
  mix(master, envelope(tone({ len: Math.floor(SR * 0.6), f0: top }), { attack: 0.01, tau: 0.25 }), end, 0.15);
  mix(master, envelope(tone({ len: Math.floor(SR * 0.6), f0: top * 1.5 }), { attack: 0.01, tau: 0.25 }), end, 0.1);
  mix(master, envelope(bandpass(noise(Math.floor(SR * 0.3), rng), 6000, 0.8), { attack: 0.02, tau: 0.12 }), end, 0.05);
  return normalize(master);
};

// イベントごとのバリエーション数と、作る関数
const EVENTS = [
  { name: 'connect', count: 3, make: makeConnect },
  { name: 'fail', count: 2, make: makeFail },
  { name: 'deliver', count: 3, make: makeDeliver },
];

mkdirSync(OUT, { recursive: true });
for (const { name, count, make } of EVENTS) {
  for (let n = 0; n < count; n++) {
    // バリエーションごとに別のシードを使う（同じ設計でも毎回ちがう音になる）
    const rng = makeRng(`${seedArg}:${name}:${n}`);
    const file = resolve(OUT, `${name}-${n}.wav`);
    writeFileSync(file, toWav(make(rng)));
    console.log(`生成: ${file}`);
  }
}
