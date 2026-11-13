// ローカルの ESLint の規則（立て直しの決まりを検査で守らせる）。規則ごとに別の ID にして、抑制の一覧が規則ごとに分かれるようにする。
// 規則は「比べ方」ではなく「元になる値に触れること」を禁じる（比べ方を変えれば抜けられるため）。

// ファイルの場所（/ 区切り）が、パターンのどれかに合うか
const inFiles = (context, patterns) => {
  const file = `/${context.filename.split('\\').join('/')}`;
  return patterns.some((p) => (p.endsWith('/**') ? file.includes(`/${p.slice(0, -2)}`) : file.endsWith(`/${p}`)));
};

const rule = (description, message, create, exclude = []) => ({
  meta: { type: 'problem', docs: { description }, schema: [], messages: { violation: message } },
  create: (context) => (inFiles(context, exclude) ? {} : create(context)),
});

// 文字列 'unknown' を右辺に持つ ?? ・||
const noUnknownFallback = rule(
  '予備値の文字列 unknown を禁じる',
  "予備値 'unknown' で埋めず、登録にない値は例外で止めること",
  (context) => ({
    LogicalExpression(node) {
      if ((node.operator === '??' || node.operator === '||') && node.right.type === 'Literal' && node.right.value === 'unknown') context.report({ node, messageId: 'violation' });
    },
  }),
);

// categoryOf の呼び出し・.category の参照・CATEGORY の参照
const noCategory = rule(
  '機器の種類（分類）に直接触れることを禁じる',
  '機器の違いは種類（category・CATEGORY・categoryOf）ではなく、能力（can）かレジストリの値で分けること',
  (context) => ({
    Identifier(node) {
      const parent = node.parent;
      // プロパティの名前だけ・宣言の名前だけは、別の規則に任せる。参照と呼び出しだけを見る
      if (node.name === 'CATEGORY' && !(parent.type === 'Property' && parent.key === node && !parent.computed) && parent.type !== 'ImportSpecifier') context.report({ node, messageId: 'violation' });
      if (node.name === 'categoryOf' && (parent.type === 'CallExpression' || (parent.type === 'MemberExpression' && parent.property === node))) context.report({ node, messageId: 'violation' });
      if (node.name === 'category' && parent.type === 'MemberExpression' && parent.property === node && !parent.computed) context.report({ node, messageId: 'violation' });
    },
  }),
  ['src/registry/**', 'src/data/categories.ts', 'src/network/nodeName.ts'],
);

// 'sandbox'・'career'・.sandbox・名前が sandbox の引数と変数
const noModeBranch = rule(
  '遊び方の名前による分岐を禁じる',
  '遊び方の違いは名前（sandbox・career）で分けず、遊び方の能力の値で分けること',
  (context) => ({
    Literal(node) {
      if (node.value === 'sandbox' || node.value === 'career') context.report({ node, messageId: 'violation' });
    },
    MemberExpression(node) {
      if (!node.computed && node.property.type === 'Identifier' && node.property.name === 'sandbox') context.report({ node: node.property, messageId: 'violation' });
    },
    Identifier(node) {
      const p = node.parent;
      const declared = (p.type === 'VariableDeclarator' && p.id === node) || (/Function/.test(p.type) && p.params?.includes(node));
      if (node.name === 'sandbox' && declared) context.report({ node, messageId: 'violation' });
    },
  }),
);

const VIEW_FORBIDDEN = new Set(['withWireless', 'compile', 'compiledNet', 'segmentsOf', 'networkColors']);
// 描画・画面から、ネットワークの計算の関数を読むこと
const noEngineInView = rule(
  '描画・画面からネットワークの計算を呼ぶことを禁じる',
  '描画と画面は、計算の結果（NetworkState）を読むだけにし、計算の関数を読まないこと',
  (context) => {
    if (!inFiles(context, ['src/components/**', 'src/game/**'])) return {};
    return {
      ImportDeclaration(node) {
        for (const s of node.specifiers) {
          if (s.type === 'ImportSpecifier' && VIEW_FORBIDDEN.has(s.imported.name)) context.report({ node: s, messageId: 'violation' });
        }
      },
    };
  },
);

// categoryOf・maxLengthOf・portSpeedOf に関数を書くこと
const noHandmadeEngineData = rule(
  '判定のデータの手作りを禁じる',
  '判定のデータ（categoryOf・maxLengthOf・portSpeedOf）は、レジストリから作る関数だけで作ること',
  (context) => ({
    Property(node) {
      const name = node.key.type === 'Identifier' ? node.key.name : node.key.value;
      if (['categoryOf', 'maxLengthOf', 'portSpeedOf'].includes(name) && (node.value.type === 'ArrowFunctionExpression' || node.value.type === 'FunctionExpression')) context.report({ node, messageId: 'violation' });
    },
  }),
  ['src/registry/**'],
);

// PC の判定（右辺が 'pc'、または CATEGORY.pc）
const isPcIn = rule(
  'PC の判定の重複を禁じる',
  'PC の判定は isPcIn（sim/project.ts）を使うこと',
  (context) => ({
    BinaryExpression(node) {
      const r = node.right;
      if ((r.type === 'Literal' && r.value === 'pc') || (r.type === 'MemberExpression' && r.object.type === 'Identifier' && r.object.name === 'CATEGORY' && r.property.name === 'pc')) context.report({ node, messageId: 'violation' });
    },
  }),
  ['src/data/categories.ts'],
);

export default {
  rules: {
    'no-unknown-fallback': noUnknownFallback,
    'no-category': noCategory,
    'no-mode-branch': noModeBranch,
    'no-engine-in-view': noEngineInView,
    'no-handmade-engine-data': noHandmadeEngineData,
    'is-pc-in': isPcIn,
  },
};
