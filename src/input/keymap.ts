// キーの割り当ての表。キー・動作の名前（文言キー）・実行する関数を1つの表にまとめる。
// ツールチップの2行目、`?` のキー操作の一覧、キーの処理（handleKey）はすべてこの表から作る。
// 入力欄に文字を入れている間は、Enter・Esc・Tab 以外を無視する（入力欄に渡す）。
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import { frontWindow } from '../ui/windows';
import { focusedProject, frontDeviceUid, useGameStore } from '../stores/useGameStore';
import type { Speed } from '../stores/useGameStore';
import { topPopup } from './popupStack';
import { mapCommands, PAN_KEY_PX } from '../game/mapControl';

// 画面の上のポップアップ・欄を開け閉めする操作（App が渡す）
export interface UiActions {
  // ポップアップを開く。同じものが開いていれば閉じる
  togglePopup: (name: 'offers' | 'shop' | 'help') => void;
  // 倉庫の欄を開け閉めする
  toggleWarehouse: () => void;
}

export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface KeyBinding {
  // 表示と照合に使うキー（例: '1' 'Esc' 'Ctrl+Z' 'Space' '[' '↑'）
  key: string;
  // 動作の識別子（ツールチップの照合に使う）
  id: string;
  // 動作の名前の文言キー
  name: LangKey;
  // 実行する。処理したら true。空（undefined）の行は、まだ動作がない（別の担当が入れる）
  run?: (ui: UiActions) => boolean;
}

// ストアの操作を行う。戻り値が false のときは処理しなかったとみなす
const act =
  (fn: (s: ReturnType<typeof useGameStore.getState>) => boolean | void) =>
  (): boolean =>
    fn(useGameStore.getState()) !== false;

// 一時停止から戻る先の速さ。停止以外の速さを変えたときに覚える
let resumeSpeed: Speed = 1;
useGameStore.subscribe((s) => {
  if (s.speed !== 0) resumeSpeed = s.speed;
});
const SPEED_STEPS: Speed[] = [1, 2, 4];

// 配線の途中 → ポップアップ → 失敗の直し方 → 一番手前のウィンドウ → 選択の道具、の順に1つずつ戻す
const escape = (): boolean => {
  const s = useGameStore.getState();
  if (s.wireStart || s.portMenu) {
    s.cancelWire();
    return true;
  }
  const top = topPopup();
  if (top) {
    // 閉じられないポップアップ（破産の画面など）は、Esc で何もしない
    if (!top.close) return false;
    top.close();
    return true;
  }
  if (s.helpUid) {
    s.setHelpUid(null);
    return true;
  }
  // 一番手前のウィンドウの、選ばれているタブを閉じる（最後のタブならウィンドウも閉じる）
  const front = frontWindow(s.windows);
  if (front) {
    s.closeTab(front.id, front.active);
    return true;
  }
  if (s.tool !== 'select' || s.placing) {
    s.setTool('select');
    return true;
  }
  return false;
};

// Enter は一番上のポップアップの主のボタン
const enter = (): boolean => {
  const top = topPopup();
  if (!top?.primary) return false;
  top.primary();
  return true;
};

// 一時停止と再開。停止からは、止める前の速さに戻す
const pause = (): boolean => {
  const s = useGameStore.getState();
  s.setSpeed(s.speed === 0 ? resumeSpeed : 0);
  return true;
};

// 速さを1段階変える。停止中は1倍に戻す
const changeSpeed = (dir: -1 | 1): boolean => {
  const s = useGameStore.getState();
  if (s.speed === 0) {
    s.setSpeed(1);
    return true;
  }
  const i = SPEED_STEPS.indexOf(s.speed);
  const next = SPEED_STEPS[i + dir];
  if (i >= 0 && next !== undefined) s.setSpeed(next);
  return true;
};

// 設計中の案件だけで効く操作（テスト・施工）
const onlyWhileDesigning =
  (fn: () => void) =>
  (): boolean => {
    if (focusedProject(useGameStore.getState())?.phase !== 'design') return false;
    fn();
    return true;
  };

// キーの表。`?` の一覧は、この並びのまま出す
export const KEYMAP: KeyBinding[] = [
  { key: '1', id: 'tool.select', name: 'ui.tool.select', run: act((s) => s.setTool('select')) },
  { key: '2', id: 'tool.wire', name: 'ui.tool.wire', run: act((s) => s.setTool('wire')) },
  { key: '3', id: 'tool.remove', name: 'ui.tool.remove', run: act((s) => s.setTool('remove')) },
  { key: 'Esc', id: 'escape', name: 'keys.escape', run: escape },
  { key: 'Enter', id: 'enter', name: 'keys.enter', run: enter },
  // 入力欄とボタンの移動は、ブラウザの既定の動作に任せる
  { key: 'Tab', id: 'focusNext', name: 'keys.focusNext' },
  { key: 'Shift+Tab', id: 'focusPrev', name: 'keys.focusPrev' },
  {
    key: 'Delete',
    id: 'delete',
    name: 'keys.delete',
    run: () => {
      // 一番手前のウィンドウの機器を撤去する（撤去できたらその画面も閉じる）
      const s = useGameStore.getState();
      const uid = frontDeviceUid(s);
      if (uid) s.removeNode(uid);
      return true;
    },
  },
  { key: 'Ctrl+Z', id: 'undo', name: 'keys.undo', run: act((s) => s.undo()) },
  // Ctrl+Shift+Z は、この行（Ctrl+Y）と同じ「やり直す」として handleKey で扱う
  { key: 'Ctrl+Y', id: 'redo', name: 'keys.redo', run: act((s) => s.redo()) },
  { key: 'Space', id: 'pause', name: 'keys.pause', run: pause },
  { key: '[', id: 'slower', name: 'keys.slower', run: () => changeSpeed(-1) },
  { key: ']', id: 'faster', name: 'keys.faster', run: () => changeSpeed(1) },
  // テストは設計中の案件と、サンドボックスで使える
  {
    key: 'T',
    id: 'test',
    name: 'ui.test',
    run: () => {
      const s = useGameStore.getState();
      if (s.mode !== 'sandbox' && focusedProject(s)?.phase !== 'design') return false;
      s.test();
      return true;
    },
  },
  { key: 'B', id: 'build', name: 'ui.build', run: onlyWhileDesigning(() => useGameStore.getState().requestBuild()) },
  { key: 'I', id: 'showIp', name: 'ui.showIp', run: act((s) => s.setShowIp(!s.showIp)) },
  // 依頼と社員の一覧は、サンドボックスでは出さない
  { key: 'M', id: 'offers', name: 'ui.offer.title', run: (ui) => (useGameStore.getState().mode === 'sandbox' ? false : (ui.togglePopup('offers'), true)) },
  { key: 'S', id: 'shop', name: 'ui.shop.title', run: (ui) => (ui.togglePopup('shop'), true) },
  { key: 'W', id: 'warehouse', name: 'ui.warehouse.title', run: (ui) => (ui.toggleWarehouse(), true) },
  { key: 'H', id: 'staffList', name: 'keys.staffList', run: () => { const s = useGameStore.getState(); if (s.mode === 'sandbox') return false; s.openWindow('staffList', ''); return true; } },
  // マップの拡大・縮小と移動（mapControl.ts の命令を呼ぶ）
  { key: '+', id: 'zoomIn', name: 'keys.zoomIn', run: () => (mapCommands.zoomIn(), true) },
  { key: '-', id: 'zoomOut', name: 'keys.zoomOut', run: () => (mapCommands.zoomOut(), true) },
  { key: '0', id: 'zoomReset', name: 'keys.zoomReset', run: () => (mapCommands.fit(), true) },
  // 矢印キーは、見える向きに動かす（上を押すと上の方が見える）
  { key: '↑', id: 'moveMap', name: 'keys.moveMap', run: () => (mapCommands.pan(0, PAN_KEY_PX), true) },
  { key: '↓', id: 'moveMap', name: 'keys.moveMap', run: () => (mapCommands.pan(0, -PAN_KEY_PX), true) },
  { key: '←', id: 'moveMap', name: 'keys.moveMap', run: () => (mapCommands.pan(PAN_KEY_PX, 0), true) },
  { key: '→', id: 'moveMap', name: 'keys.moveMap', run: () => (mapCommands.pan(-PAN_KEY_PX, 0), true) },
  { key: '?', id: 'help', name: 'keys.help', run: (ui) => (ui.togglePopup('help'), true) },
];

const NAMES: Record<string, string> = {
  Escape: 'Esc',
  ' ': 'Space',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

// キーの入力を表の書き方に直す（英字は大文字、Shift+Tab と Ctrl は前に付ける）
export function keyName(e: KeyInput): string {
  let name = NAMES[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  if (e.key === 'Tab' && e.shiftKey) name = 'Shift+Tab';
  if (e.ctrlKey || e.metaKey) name = `Ctrl+${name}`;
  return name;
}

// 動作の識別子から、表の最初のキーを返す（なければ undefined）
export function keyOfAction(id: string): string | undefined {
  return KEYMAP.find((b) => b.id === id)?.key;
}

// ツールチップの文字。1行目は動作の名前、2行目はキー（キーがなければ名前だけ）。withKey が false のときはキーを出さない（スマホ）
export function tipText(name: LangKey, id: string, withKey = true): string {
  const key = withKey ? keyOfAction(id) : undefined;
  return key ? `${t(name)}\n${t('ui.tip.key', { key })}` : t(name);
}

// Ctrl と組み合わさったときや = でも、マップの拡大・縮小として扱うキー
const ZOOM_KEYS = new Map<string, string>([['+', '+'], ['=', '+'], ['-', '-'], ['0', '0']]);

// 入力欄にいるときも効くキー
const INPUT_KEYS = ['Enter', 'Esc', 'Tab', 'Shift+Tab'];

// キーを処理する。処理したら true（呼び出し側で既定の動作を止める）
export function handleKey(e: KeyInput & { target: EventTarget | null }, ui: UiActions): boolean {
  if (e.altKey) return false;
  const pressed = keyName(e);
  // Ctrl+Shift+Z は Ctrl+Y と同じ（やり直す）
  const undoRedo = pressed === 'Ctrl+Z' && e.shiftKey ? 'Ctrl+Y' : pressed;
  // Ctrl と + - 0 は、ブラウザの拡大・縮小ではなくマップの拡大・縮小に使う（= は + と同じ）
  const zoomKey = ZOOM_KEYS.get(e.key);
  const name = zoomKey && (e.ctrlKey || e.metaKey || e.key === '=') ? zoomKey : undoRedo;
  const target = e.target as HTMLElement | null;
  const editing = !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
  if (editing && !INPUT_KEYS.includes(name)) return false;
  // Enter で押すボタンの上では、ボタンの既定の動作（クリック）に任せる
  if (name === 'Enter' && target?.tagName === 'BUTTON') return false;
  // 押したボタンにフォーカスが残っていると、Space でそのボタンが押されてしまう。フォーカスを外してから動作させる
  if (name === 'Space' && target?.tagName === 'BUTTON') target.blur();
  const binding = KEYMAP.find((b) => b.key === name);
  if (!binding?.run) return false;
  return binding.run(ui);
}
