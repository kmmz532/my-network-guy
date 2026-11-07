// 判定の重複を禁じる（N120 の 5）。同じ事実は共通の関数だけで判定する。
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'scripts/**', 'public/**'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // 担当中の社員の集合は busyStaff（sim/crew.ts）で作る（N117）
          selector: "CallExpression[callee.property.name='flatMap'] > ArrowFunctionExpression > MemberExpression[property.name='crew']",
          message: '担当中の社員は busyStaff（sim/crew.ts）で作る（N117）',
        },
        {
          // PC の判定は isPcIn（sim/project.ts）を使う（N116）
          selector: "BinaryExpression[right.value='pc']",
          message: 'PC の判定は isPcIn（sim/project.ts）を使う（N116）',
        },
        {
          selector: "BinaryExpression[right.property.name='pc'][right.object.name='CATEGORY']",
          message: 'PC の判定は isPcIn（sim/project.ts）を使う（N116）',
        },
      ],
    },
  },
  // 分類の定義そのもの（isPcCategory）は、直接比べる場所
  { files: ["src/data/categories.ts"], rules: { "no-restricted-syntax": "off" } },
);
