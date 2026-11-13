// ローカルの規則の試験: 違反する例と、違反しない例（除外のファイルを含む）
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import plugin from './index.mjs';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });
const bad = (code, filename = 'src/x/a.js') => ({ code, filename, errors: 1 });
const ok = (code, filename = 'src/x/a.js') => ({ code, filename });

tester.run('no-unknown-fallback', plugin.rules['no-unknown-fallback'], {
  valid: [ok("const a = b ?? 'x';"), ok("const a = b || 'none';")],
  invalid: [bad("const a = b ?? 'unknown';"), bad("const a = b || 'unknown';")],
});

tester.run('no-category', plugin.rules['no-category'], {
  valid: [
    ok('const a = can(node.device, "svi");'),
    ok('const c = CATEGORY.pc;', 'src/data/categories.ts'),
    ok('const x = data.categoryOf(d);', 'src/registry/devices.js'),
    ok('const o = { category: 1 };'),
  ],
  invalid: [
    bad("if (data.categoryOf(n.device) === 'router') {}"),
    bad('const c = categoryOf(n.device);'),
    bad('const c = info.category;'),
    bad('const c = CATEGORY.router;'),
    bad("switch (x) { case CATEGORY.server: break; }"),
    bad('const ok = [CATEGORY.pc].includes(c);'),
  ],
});

tester.run('no-mode-branch', plugin.rules['no-mode-branch'], {
  valid: [ok("const m = mode === 'play';"), ok('const x = s.mode;')],
  invalid: [bad("if (s.mode === 'sandbox') {}"), bad("const m = 'career';"), bad('const x = o.sandbox;'), bad('function f(sandbox) {}'), bad('const sandbox = true;')],
});

tester.run('no-engine-in-view', plugin.rules['no-engine-in-view'], {
  valid: [
    ok("import { withWireless } from '../network/netState';", 'src/sim/a.js'),
    ok("import { portLabel } from './devicePorts';", 'src/components/A.js'),
  ],
  invalid: [
    bad("import { withWireless } from '../network/netState';", 'src/components/A.js'),
    bad("import { networkColors } from '../network/netColor';", 'src/game/Scene.js'),
    bad("import { compile } from '../network/compile';", 'src/components/A.js'),
  ],
});

tester.run('no-handmade-engine-data', plugin.rules['no-handmade-engine-data'], {
  valid: [ok('const e = { categoryOf: (d) => 1 };', 'src/registry/engine.js'), ok('const e = { categoryOf: fn };')],
  invalid: [bad('const e = { categoryOf: (d) => 1 };'), bad('const e = { maxLengthOf: function () {} };'), bad('const e = { portSpeedOf: () => 1 };')],
});

tester.run('is-pc-in', plugin.rules['is-pc-in'], {
  valid: [ok("const a = c === 'pc';", 'src/data/categories.ts'), ok("const a = c === 'server';")],
  invalid: [bad("const a = c === 'pc';"), bad('const a = c === CATEGORY.pc;')],
});
