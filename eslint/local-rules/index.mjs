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

// 構成（Core）のキーを set・setState の引数に直接書くこと（初期値の書き込みは除外）
const CORE_KEYS = new Set(['office', 'active', 'owned', 'clock', 'focus', 'staff', 'staffSeq', 'candidates', 'offers', 'completed', 'deliveries', 'familiarity', 'effects', 'companyExp', 'reputation']);
const keyName = (prop) => (prop.computed ? (prop.key.type === 'Literal' ? prop.key.value : null) : prop.key.type === 'Identifier' ? prop.key.name : prop.key.value);
// 構成を書く呼び出し: Zustand の set（引数の名前）と、ストアの setState。Map の set は対象にしない
const isSetCall = (callee) => (callee.type === 'Identifier' && callee.name === 'set') || (callee.type === 'MemberExpression' && !callee.computed && callee.property.name === 'setState');
const coreKeysIn = (obj) => obj.properties.filter((p) => p.type === 'Property' && CORE_KEYS.has(keyName(p)));
const returnedObjects = (fn) => {
  if (fn.body.type === 'ObjectExpression') return [fn.body];
  return fn.body.type === 'BlockStatement' ? fn.body.body.filter((s) => s.type === 'ReturnStatement' && s.argument?.type === 'ObjectExpression').map((s) => s.argument) : [];
};
// 利用者の編集でない仕組みの処理（案件の進行・報酬・教材を開く・案件の切り替え）。関数の名前で除外する
const CORE_SET_FUNCTIONS = {
  'src/stores/slices/contractSlice.ts': ['declineOffer'], // 案件の進行（依頼の辞退）
  'src/stores/slices/economySlice.ts': ['grantCompanyExp'], // 経験値と報酬の受け取り
  'src/stores/slices/designSlice.ts': ['openLesson', 'test'], // 教材を開く・検査の結果の書き込み
  'src/stores/slices/uiSlice.ts': ['setFocus'], // 案件の切り替え
};
const inExcludedFunction = (context, node) => {
  const file = `/${context.filename.split('\\').join('/')}`;
  const entry = Object.entries(CORE_SET_FUNCTIONS).find(([f]) => file.endsWith(`/${f}`));
  if (!entry) return false;
  return context.sourceCode.getAncestors(node).some((n) => n.type === 'Property' && !n.computed && n.key.type === 'Identifier' && entry[1].includes(n.key.name));
};
const noCoreSet = rule(
  '構成のキーを set・setState で直接書くことを禁じる',
  '構成（Core）は操作（applyOperation・dispatch）を通して変えること。set・setState の引数に構成のキーを書かない',
  (context) => ({
    CallExpression(node) {
      if (!isSetCall(node.callee)) return;
      if (inExcludedFunction(context, node)) return;
      for (const arg of node.arguments) {
        const objects = arg.type === 'ObjectExpression' ? [arg] : /Function/.test(arg.type) ? returnedObjects(arg) : [];
        for (const obj of objects) {
          for (const prop of coreKeysIn(obj)) context.report({ node: prop, messageId: 'violation' });
        }
      }
    },
  }),
  ['src/stores/gameOps.ts', 'src/stores/tickSystems.ts', 'src/stores/slices/sessionSlice.ts', 'src/stores/useGameStore.ts', 'src/stores/slices/debugSlice.ts' /* デバッグの操作は遊びの操作ではない */],
);

// 見た目（色・地・枠・文字・影・不透明度）の名前のプロパティ。ui/ の部品の外では、オブジェクトの作り方を問わず名前で禁じる
const LOOK_PROP = /^(color|background.*|border.*|fontSize|fontWeight|boxShadow|opacity)$/;
const noLookProps = rule(
  '見た目のプロパティを ui/ の外で書くことを禁じる',
  '見た目（色・地・枠・文字・影・不透明度）は src/components/ui/ の部品が決める。部品の種類か layout で指定すること',
  (context) => ({
    Property(node) {
      // 分割代入の名前は、書くのではなく読むだけ
      if (node.parent.type === 'ObjectPattern') return;
      const name = node.computed ? (node.key.type === 'Literal' ? node.key.value : null) : node.key.type === 'Identifier' ? node.key.name : node.key.value;
      if (typeof name === 'string' && LOOK_PROP.test(name)) context.report({ node, messageId: 'violation' });
    },
  }),
  ['src/components/ui/**'],
);

const NATIVE_CONTROLS = new Set(['button', 'input', 'select', 'textarea']);
const noNativeControl = rule(
  '標準のボタン・入力欄の直接の使用を禁じる',
  '<button>・<input>・<select>・<textarea> は直接使わず、src/components/ui/ の部品を使うこと',
  (context) => ({
    JSXOpeningElement(node) {
      if (node.name.type === 'JSXIdentifier' && NATIVE_CONTROLS.has(node.name.name)) context.report({ node, messageId: 'violation' });
    },
  }),
  ['src/components/ui/**'],
);

// *Style・*Color の名前の export と、相対の import（外部の型の名前は対象にしない）
const LOOK_NAME = /(Style|Color)$/;
const noLookExport = rule(
  '見た目の定数（*Style・*Color）の受け渡しを禁じる',
  '見た目の定数を export・import で受け渡さず、src/components/ui/ の部品にすること',
  (context) => ({
    ExportNamedDeclaration(node) {
      const d = node.declaration;
      if (d?.type === 'VariableDeclaration') {
        for (const v of d.declarations) if (v.id.type === 'Identifier' && LOOK_NAME.test(v.id.name)) context.report({ node: v, messageId: 'violation' });
      } else if (d && (d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id && LOOK_NAME.test(d.id.name)) {
        context.report({ node: d, messageId: 'violation' });
      }
      for (const s of node.specifiers) {
        const name = s.exported.type === 'Identifier' ? s.exported.name : s.exported.value;
        if (LOOK_NAME.test(name)) context.report({ node: s, messageId: 'violation' });
      }
    },
    ImportDeclaration(node) {
      if (!/^(\.|@\/)/.test(node.source.value) || node.importKind === 'type') return;
      for (const s of node.specifiers) {
        if (s.type === 'ImportSpecifier' && s.importKind !== 'type') {
          const name = s.imported.type === 'Identifier' ? s.imported.name : s.imported.value;
          if (LOOK_NAME.test(name)) context.report({ node: s, messageId: 'violation' });
        }
      }
    },
  }),
  ['src/components/ui/**'],
);

export default {
  rules: {
    'no-unknown-fallback': noUnknownFallback,
    'no-category': noCategory,
    'no-mode-branch': noModeBranch,
    'no-engine-in-view': noEngineInView,
    'no-handmade-engine-data': noHandmadeEngineData,
    'is-pc-in': isPcIn,
    'no-core-set': noCoreSet,
    'no-look-props': noLookProps,
    'no-native-control': noNativeControl,
    'no-look-export': noLookExport,
  },
};
