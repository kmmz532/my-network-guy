// 同じ会社（セーブの枠）を複数のタブで開いたときの検出（N27・N133）。BroadcastChannel で、後から開いたタブを見つける。
// 会社ごとに判定する。別の会社なら同時に開ける。同じ会社を開いたときは、後から開いたタブが「別のタブで開いています」を受け取り、続けるまで操作を止める。
// 先に開いていたタブは何も出さない。
const CHANNEL = 'network-ya-tab';

interface Message {
  type: 'alive' | 'here';
  id: string;
  // 今開いている会社の枠（タイトル画面は null）
  slot: number | null;
}

export interface TabGuard {
  // 今開いている会社の枠を変える（会社を始める・読み込むと呼ぶ）
  setSlot: (slot: number | null) => void;
  stop: () => void;
}

// 同じ会社か（どちらかが null なら、会社を開いていないため違わない）
export const sameCompany = (mine: number | null, theirs: number | null): boolean => mine !== null && mine === theirs;

// 開いたときに1回だけ呼ぶ。同じ会社の別のタブが見つかったら onConflict を呼ぶ（新しく開いたタブだけ）。BroadcastChannel がなければ何もしない
export const startTabGuard = (onConflict: () => void, slot: number | null = null): TabGuard => {
  if (typeof BroadcastChannel === 'undefined') return { setSlot: () => undefined, stop: () => undefined };
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const channel = new BroadcastChannel(CHANNEL);
  let mine = slot;
  channel.onmessage = (e: MessageEvent<Message>) => {
    const msg = e.data;
    if (!msg || msg.id === id) return;
    // 先に開いていたタブは、同じ会社の新しいタブの「alive」に「here」で答える
    if (msg.type === 'alive' && sameCompany(mine, msg.slot)) channel.postMessage({ type: 'here', id, slot: mine } satisfies Message);
    // 新しく開いたタブは、同じ会社の先のタブからの「here」で、別のタブがあると分かる
    if (msg.type === 'here' && sameCompany(mine, msg.slot)) onConflict();
  };
  channel.postMessage({ type: 'alive', id, slot: mine } satisfies Message);
  return {
    setSlot: (next) => {
      mine = next;
      channel.postMessage({ type: 'alive', id, slot: next } satisfies Message);
    },
    stop: () => channel.close(),
  };
};
