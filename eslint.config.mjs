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
      'local/no-topology-outside-engine': 'error',
      'local/no-handmade-engine-data': 'error',
      'local/is-pc-in': 'error',
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
);
