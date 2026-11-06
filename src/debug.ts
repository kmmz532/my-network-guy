// デバッグの機能を有効にするかの判定（N54）。URL のパラメータ ?debug=1 または ?debug=true のときだけ有効。
// 判定はこの1か所だけ。起動時に1回だけ読み、設定やセーブには保存しない。
const ON_VALUES = new Set(['1', 'true']);

export function isDebugEnabled(search: string): boolean {
  const value = new URLSearchParams(search).get('debug');
  return value !== null && ON_VALUES.has(value);
}

export const DEBUG_ENABLED: boolean = typeof window !== 'undefined' && isDebugEnabled(window.location.search);
