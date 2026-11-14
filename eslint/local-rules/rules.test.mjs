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

tester.run('no-core-set', plugin.rules['no-core-set'], {
  valid: [
    ok('set({ ui: 1 });'),
    ok("set({ office: x }, false, 'x');", 'src/stores/gameOps.ts'),
    ok('set({ office: x });', 'src/stores/slices/sessionSlice.ts'),
    ok('const o = { office: x };'),
    ok('useGameStore.setState({ owned: list });', 'src/stores/useGameStore.ts'),
    ok('set((s) => ({ ui: s.ui }));'),
    ok('map.set(key, { office: 1 });'),
  ],
  invalid: [
    bad('set({ office: x });'),
    { code: 'set({ active: id, clock: 3 });', filename: 'src/x/a.js', errors: 2 },
    bad('useGameStore.setState({ staff: list });'),
    bad("useGameStore.setState({ 'reputation': 1 });"),
    bad('set({ offers });'),
    bad('set((s) => ({ owned: [...s.owned, id] }));'),
    bad('set((s) => { return { candidates: [] }; });'),
  ],
});

const jsxTester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } } });
const UI = 'src/components/ui/Button.jsx';
const VIEW = 'src/components/Panel.jsx';

jsxTester.run('no-look-props', plugin.rules['no-look-props'], {
  valid: [
    ok('const s = { width: 1, margin: 2, display: "flex" };', VIEW),
    ok('const { color } = props;', VIEW),
    ok('const s = { color: "red", border: "1px solid" };', UI),
    ok('const a = <Swatch color={c} />;', VIEW),
  ],
  invalid: [
    bad('const s = { color: "red" };', VIEW),
    bad('const s = { background: "#fff" };', VIEW),
    bad('const s = { backgroundColor: c };', VIEW),
    bad('const s = { borderRadius: 4 };', VIEW),
    bad('const s = { "border-left": 1 };', VIEW),
    bad('const s = { fontSize: 12 };', VIEW),
    bad('const s = { fontWeight: 700 };', VIEW),
    bad('const s = { boxShadow: "none" };', VIEW),
    bad('const s = { opacity: 0.5 };', VIEW),
    bad('const f = () => ({ ...base, color: c });', VIEW),
    bad('const a = <div style={{ color: c }} />;', VIEW),
  ],
});

jsxTester.run('no-native-control', plugin.rules['no-native-control'], {
  valid: [ok('const a = <Button />;', VIEW), ok('const a = <button />;', UI), ok('const a = <div />;', VIEW)],
  invalid: [bad('const a = <button />;', VIEW), bad('const a = <input type="text" />;', VIEW), bad('const a = <select></select>;', VIEW), bad('const a = <textarea />;', VIEW)],
});

jsxTester.run('no-look-export', plugin.rules['no-look-export'], {
  valid: [
    ok('export const size = 1;', VIEW),
    ok('import { TextStyle } from "pixi.js";', VIEW),
    ok('import { x } from "./a";', VIEW),
    ok('export const buttonStyle = {};', UI),
  ],
  invalid: [
    bad('export const buttonStyle = {};', VIEW),
    bad('export function cellColor() {}', VIEW),
    bad('const a = 1; export { a as inputStyle };', VIEW),
    bad('import { buttonStyle } from "./devicePorts";', VIEW),
    bad('import { buttonStyle } from "../ui/x";', VIEW),
  ],
});
