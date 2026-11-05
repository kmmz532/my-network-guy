// 効果音。音源は scripts/gen-sfx.mjs で合成した WAV（public/sfx/）を使う。
// 同じ出来事に複数の音源があり、鳴らすたびに 1 つを選ぶ。設定の「効果音」がオフのときは鳴らさない。
// 音源は最初に鳴らすときに読み込んで復号し、以後は使い回す。読み込みや再生に失敗したときは何もしない。
// 音は、ユーザーの操作（クリックなど）の後に鳴るので、ブラウザの自動再生の制限には当たらない。
import { loadSettings } from '../settings/settings';

type Sfx = 'connect' | 'fail' | 'deliver';

// イベントごとのバリエーション数（scripts/gen-sfx.mjs の EVENTS と合わせる）
const VARIANTS: Record<Sfx, number> = { connect: 3, fail: 2, deliver: 3 };

let ctx: AudioContext | null = null;
const cache = new Map<string, Promise<AudioBuffer | null>>();

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

// 1 つの WAV を読み込んで復号する（失敗したら null）
const load = (c: AudioContext, url: string): Promise<AudioBuffer | null> => {
  const hit = cache.get(url);
  if (hit) return hit;
  const p = fetch(url)
    .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
    .then((data) => c.decodeAudioData(data))
    .catch(() => null);
  cache.set(url, p);
  return p;
};

// 出来事の音源を 1 つ選んで鳴らす
const play = (name: Sfx): void => {
  try {
    if (!loadSettings().sound) return;
    const c = context();
    if (!c) return;
    const n = Math.floor(Math.random() * VARIANTS[name]);
    const url = `${import.meta.env.BASE_URL}sfx/${name}-${n}.wav`;
    void load(c, url).then((buffer) => {
      if (!buffer) return;
      const src = c.createBufferSource();
      src.buffer = buffer;
      src.connect(c.destination);
      src.start();
    });
  } catch {
    // 音が出せない環境では何もしない
  }
};

// つながった: ケーブルの接触音と、通信の立ち上がり
export const playConnect = (): void => play('connect');

// 失敗した: 低いうなり
export const playFail = (): void => play('fail');

// 納品した: 上がるベル音と余韻
export const playDeliver = (): void => play('deliver');
