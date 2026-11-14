// tokens.css の変数を TS から参照する名前（`var(--…)` の文字列）。CSS で書けない場所でだけ使う。
export const TOKEN = {
  bgCard: 'var(--bg-card)',
  bgField: 'var(--bg-field)',
  fg: 'var(--fg)',
  fgOnField: 'var(--fg-on-field)',
  line: 'var(--line)',
  stError: 'var(--st-error)',
} as const;
