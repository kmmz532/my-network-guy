// 立て直しの決まりを検査で守らせる。規則はローカルのプラグイン（eslint/local-rules）に1つずつ別の ID で書く。
// 今ある違反は eslint-suppressions.json に記録してあり、件数は減る一方にする（直したら npx eslint src --prune-suppressions）。
import tseslint from 'typescript-eslint';
import local from './eslint/local-rules/index.mjs';

export default tseslint.config(
  { ignores: ['dist/**', 'dist-shoot/**', 'node_modules/**', 'scripts/**', 'public/**', 'eslint/**'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
    plugins: { local },
    rules: {
      'local/no-unknown-fallback': 'error',
      'local/no-category': 'error',
      'local/no-mode-branch': 'error',
      'local/no-engine-in-view': 'error',
      'local/no-handmade-engine-data': 'error',
      'local/is-pc-in': 'error',
      'local/no-core-set': 'error',
      // 機器・ケーブル・家具の定義は登録表（src/registry）から引く。読み込むのは src/registry/game.ts だけ
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'virtual:game-data',
              importNames: ['devices', 'cables', 'furniture'],
              message: '機器・ケーブル・家具の定義は登録表から引く（src/registry/query.ts）。読み込むのは src/registry/game.ts だけ',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          // 担当中の社員の集合は busyStaff（sim/crew.ts）で作る（N117）
          selector: "CallExpression[callee.property.name='flatMap'] > ArrowFunctionExpression > MemberExpression[property.name='crew']",
          message: '担当中の社員は busyStaff（sim/crew.ts）で作る（N117）',
        },
      ],
    },
  },
  {
    // 世界の型は、画面・保存・状態の層を読まない（ARCH.md 4-1）
    files: ['src/company/**/*.{ts,tsx}'],
    ignores: ['src/company/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/services/**', '**/stores/**', '**/components/**', '**/game/**'],
              message: 'src/company/ は services・stores・components・game を読まない（ARCH.md 4-1）',
            },
          ],
        },
      ],
    },
  },
  {
    // 登録表の入口だけは、定義を読んで登録する
    files: ['src/registry/game.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // 試験は状態を直接用意してよい
    files: ['src/**/*.test.ts'],
    rules: { 'local/no-core-set': 'off' },
  },
);
