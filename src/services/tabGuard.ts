// 同じゲームを複数のタブで開いたときの検出（N27）。BroadcastChannel で、後から開いたタブを見つける。
// 後から開いたタブ（新しいタブ）は「別のタブで開いています」を出し、利用者が続けるまで操作を止める。先に開いていたタブは何も出さない。
const CHANNEL = 'network-ya-tab';

interface Message {
  type: 'alive' | 'here';
  id: string;
}

// 開いたときに1回だけ呼ぶ。別のタブが見つかったら onConflict を呼ぶ（新しく開いたタブだけ）。BroadcastChannel がなければ何もしない
export const startTabGuard = (onConflict: () => void): (() => void) => {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (e: MessageEvent<Message>) => {
    const msg = e.data;
    if (!msg || msg.id === id) return;
    // 先に開いていたタブは、新しく開いたタブの「alive」に「here」で答える
    if (msg.type === 'alive') channel.postMessage({ type: 'here', id } satisfies Message);
    // 新しく開いたタブは、先のタブからの「here」で、別のタブがあると分かる
    if (msg.type === 'here') onConflict();
  };
  channel.postMessage({ type: 'alive', id } satisfies Message);
  return () => channel.close();
};
