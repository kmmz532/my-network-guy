// 端末ごとの設定（UIの大きさ・案内・名前とIPの表示・初期の速さ）。セーブデータとは別に localStorage へ保存する。
// 読めないときや壊れているときは既定の値で動く（例外を外へ出さない）。

export const UI_SCALES = [0.8, 1, 1.25, 1.5] as const;
export type UiScale = (typeof UI_SCALES)[number];

export const START_SPEEDS = [1, 2, 4] as const;
export type StartSpeed = (typeof START_SPEEDS)[number];

// 時間が止まっているときに施工を依頼したときの扱い。ask は確認を出す、play は1倍で進める、stay は止めたまま施工を依頼する
export const PAUSED_BUILD_MODES = ['ask', 'play', 'stay'] as const;
export type PausedBuildMode = (typeof PAUSED_BUILD_MODES)[number];

// 自動保存の間隔。off はしない、daily はゲーム内の毎日の朝0時、weekly は7日ごと（開始日から数えて7の倍数の日の朝0時）
export const AUTO_SAVE_MODES = ['off', 'daily', 'weekly'] as const;
export type AutoSaveMode = (typeof AUTO_SAVE_MODES)[number];

export interface Settings {
  uiScale: UiScale;
  // 初めての概念の案内を出すか（P7 で使う。今は保存するだけ）
  guide: boolean;
  // 機器の名前とIPアドレスを画面に出すか（ストアの showIp と同じ値）
  showIp: boolean;
  // 時間を進める初期の速さ（案件を始めたとき・新しいゲームを始めたとき）
  startSpeed: StartSpeed;
  // 時間が止まっているときの施工の扱い（「今後この確認を出さない」で変える）
  pausedBuild: PausedBuildMode;
  // 自動保存の間隔（既定は毎日。セーブデータのスロットへ書く）
  autoSave: AutoSaveMode;
  // PC・サーバーのIPアドレスを、つないだセグメントの空いているアドレスから自動で振るか（既定はオン）
  autoIp: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  uiScale: 1,
  guide: true,
  showIp: true,
  startSpeed: 1,
  pausedBuild: 'ask',
  autoSave: 'daily',
  autoIp: true,
};

export const SETTINGS_KEY = 'network-ya.settings.v1';

// 保存された文字列を読む。壊れた値や範囲外の値は既定の値に戻す（それ以外の値は残す）
export function parseSettings(raw: string | null): Settings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (typeof data !== 'object' || data === null) return { ...DEFAULT_SETTINGS };
  const d = data as Record<string, unknown>;
  return {
    uiScale: (UI_SCALES as readonly unknown[]).includes(d.uiScale) ? (d.uiScale as UiScale) : DEFAULT_SETTINGS.uiScale,
    guide: typeof d.guide === 'boolean' ? d.guide : DEFAULT_SETTINGS.guide,
    showIp: typeof d.showIp === 'boolean' ? d.showIp : DEFAULT_SETTINGS.showIp,
    startSpeed: (START_SPEEDS as readonly unknown[]).includes(d.startSpeed)
      ? (d.startSpeed as StartSpeed)
      : DEFAULT_SETTINGS.startSpeed,
    pausedBuild: (PAUSED_BUILD_MODES as readonly unknown[]).includes(d.pausedBuild)
      ? (d.pausedBuild as PausedBuildMode)
      : DEFAULT_SETTINGS.pausedBuild,
    autoSave: (AUTO_SAVE_MODES as readonly unknown[]).includes(d.autoSave)
      ? (d.autoSave as AutoSaveMode)
      : DEFAULT_SETTINGS.autoSave,
    autoIp: typeof d.autoIp === 'boolean' ? d.autoIp : DEFAULT_SETTINGS.autoIp,
  };
}

// 読み込み。localStorage が使えないときは既定の値
export function loadSettings(): Settings {
  try {
    return parseSettings(window.localStorage.getItem(SETTINGS_KEY));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

// 一部の項目だけを変えて保存する。保存できなくても、戻り値の設定は使える
export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch };
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // 保存できない端末では、この画面を開いている間だけ有効
  }
  return next;
}

// UIの大きさの倍率をルート要素の CSS 変数 --ui-scale に入れる（各部品は var(--ui-scale) を掛ける）
export function applyUiScale(scale: UiScale): void {
  try {
    document.documentElement.style.setProperty('--ui-scale', String(scale));
  } catch {
    // DOM が使えない環境では何もしない
  }
}
