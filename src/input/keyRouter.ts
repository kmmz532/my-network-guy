// キー入力の受け口。`window` への keydown の登録は、ここの1か所だけにする。
// キーは次の順に受ける。先に受けた処理が true を返したら、それ以降へ渡さない。
//   1. 横取り（captureKeys）: ドラッグ中・一覧を開いている間など、一時的にキーを奪う処理。あとから登録したものが先に受ける。
//      DOM の要素より先（capture の段階）に受け、受けたキーは要素にも渡さない。
//   2. 場面の層（addKeyLayer）: 場面が持つキー（タイトルの Enter・矢印など）。あとから登録したものが先に受ける。
//   3. キーの表（KEYMAP）: ゲームの場面だけ。ポップアップ → ウィンドウ → マップ・道具の順は keymap.ts の escape が持つ。
// 入力欄などの要素が自分で受けて止めたキー（stopPropagation）は、2 と 3 に届かない。
import { handleKey } from './keymap';

export type KeyHandler = (e: KeyboardEvent) => boolean;

interface Listenable {
  addEventListener(type: 'keydown', listener: (e: KeyboardEvent) => void, capture?: boolean): void;
  removeEventListener(type: 'keydown', listener: (e: KeyboardEvent) => void, capture?: boolean): void;
}

export function createKeyRouter(table: KeyHandler) {
  const captures: KeyHandler[] = [];
  const layers: KeyHandler[] = [];

  // 登録する。戻り値を呼ぶと取り除く
  const push = (list: KeyHandler[], handler: KeyHandler): (() => void) => {
    list.push(handler);
    return () => {
      const i = list.indexOf(handler);
      if (i >= 0) list.splice(i, 1);
    };
  };

  // あとから登録したものから順に呼び、処理したものがあれば true
  const run = (list: readonly KeyHandler[], e: KeyboardEvent): boolean => {
    for (let i = list.length - 1; i >= 0; i--) if (list[i](e)) return true;
    return false;
  };

  const onCapture = (e: KeyboardEvent): void => {
    if (!run(captures, e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  const onKey = (e: KeyboardEvent, useTable: boolean): void => {
    if (run(layers, e) || (useTable && table(e))) e.preventDefault();
  };

  return {
    captureKeys: (handler: KeyHandler) => push(captures, handler),
    addKeyLayer: (handler: KeyHandler) => push(layers, handler),
    // 受け口を target（通常は window）につなぐ。table が true のとき、キーの表も使う（ゲームの場面）。戻り値で外す
    attach(target: Listenable, options: { table: boolean }): () => void {
      const bubble = (e: KeyboardEvent) => onKey(e, options.table);
      target.addEventListener('keydown', onCapture, true);
      target.addEventListener('keydown', bubble);
      return () => {
        target.removeEventListener('keydown', onCapture, true);
        target.removeEventListener('keydown', bubble);
      };
    },
  };
}

export const keyRouter = createKeyRouter(handleKey);
export const { captureKeys, addKeyLayer } = keyRouter;
