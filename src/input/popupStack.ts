// 開いているポップアップの重ね順。Esc は一番上のポップアップを閉じ、Enter は一番上の主のボタンを押す。
// 画面の部品（components/Modal.tsx）が登録と解除を行う。

export interface PopupEntry {
  // Esc で閉じる処理。なければ Esc で閉じられない（破産の画面など）
  close?: () => void;
  // Enter で押す主のボタン
  primary?: () => void;
}

const stack: PopupEntry[] = [];

// 重ねる。戻り値を呼ぶと取り除く
export function pushPopup(entry: PopupEntry): () => void {
  stack.push(entry);
  return () => {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
  };
}

// 一番上のポップアップ（なければ undefined）
export function topPopup(): PopupEntry | undefined {
  return stack[stack.length - 1];
}
