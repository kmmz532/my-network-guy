// 命令の列の記録: 場面（教材の初期の構成）ごとに、設定の命令の列を1行ずつ流し、各行の出力と、流し終えた後の構成（保存の形）を記録する。
// 命令の列は src/__golden__/terminal/<場面>.txt に置く。登録されたすべての命令が、いずれかの列で1回以上解釈されることを確かめる
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lessons } from 'virtual:game-data';
import { gameEnv } from '../sim/env';
import { lessonLinks, lessonNodes, lessonPlans } from '../sim/lesson';
import { focusedOf, type Core, type Project } from '../sim/project';
import { applyOperation, type OpContext } from '../company/apply';
import type { GameMap } from '../data/schema';
import langJson from '../assets/lang/ja_jp.json';
import officeSmall from '../assets/data/maps/office_small.json';
import { analyze } from '../network/engine/analyze';
import { INITIAL_SESSION } from '../network/command/modes';
import { commandContextOf, runLine } from '../network/command/run';
import { parseLine } from '../network/command/parse';
import { COMMANDS } from '../network/command/registry';
import type { TerminalSession } from '../network/command/types';
import type { NetLink } from '../network/types';

const snapDir = join(import.meta.dirname, 'snap');
const scenesDir = join(import.meta.dirname, 'terminal');
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
// 文言を引かず、キーと引数をそのまま並べる（言語ファイルの文言の変更で記録が変わらないようにする）
const tr = (key: string, params?: Record<string, string | number>): string => (params ? `${key} ${JSON.stringify(params)}` : key);

// 設定の操作は焦点の案件を対象にする。地図は設定の操作では使わない
const opCtx: OpContext = { env: gameEnv, target: 'focus', map: null, hq: officeSmall as unknown as GameMap, mode: 'career' };

// 場面の命令の列を流す。@ の行で機器を選び、それ以外の行を1つの命令として流す。モードは機器ごとに持ち、列の中で引き継ぐ
// 解釈された命令の ID は interpreted に集める（モードの中だけで解釈される命令も数えるため、列を流して確かめる）
const runScene = (lessonId: string, text: string, interpreted: Set<string> = new Set()) => {
  const lesson = lessons.find((l) => l.id === lessonId);
  if (!lesson) throw new Error(`教材 ${lessonId} がない`);
  const nodes = lessonNodes(lesson);
  const links: NetLink[] = lessonLinks(lesson);
  const segments = lessonPlans(nodes, links, gameEnv.engine);
  // 教材の構成を、設計中の案件として持つ（設定の操作は焦点の案件を対象にする）
  const project = { id: 'p', kind: 'fixed', baseId: lessonId, params: {}, nodes, links, segments, seq: nodes.length + 1, testedOk: false, built: { nodes: [], links: [] }, inheritedLinks: [], phase: 'design', contract: { inhouse: false, map: 'hq', furniture: [] } } as unknown as Project;
  let core = { active: [project], focus: 'p', owned: {} } as unknown as Core;
  let uid = '';
  const sessions = new Map<string, TerminalSession>();
  const log: unknown[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('@')) {
      uid = line.slice(1);
      log.push({ node: uid });
      continue;
    }
    const current = focusedOf(core) as Project;
    const node = current.nodes.find((n) => n.uid === uid);
    if (!node) throw new Error(`場面 ${lessonId}: 機器 ${uid} がない`);
    const state = analyze({ nodes: current.nodes, links: current.links, plans: current.plans }, gameEnv.engine);
    const session = sessions.get(uid) ?? INITIAL_SESSION;
    const parsed = parseLine(line, session);
    if (parsed !== null && 'spec' in parsed) interpreted.add(parsed.spec.id);
    const result = runLine(line, commandContextOf({ node, nodes: current.nodes, links: current.links, data: gameEnv.engine, state }, false, session), tr);
    // モードを変えた行は、変えた後のモードを記録に残す
    const mode = result.session === null ? {} : { mode: result.session.mode, ...(result.session.process === null ? {} : { process: result.session.process }), ...(result.session.iface === null ? {} : { iface: result.session.iface }) };
    if (result.change !== null) {
      // 設定の操作は、画面（TerminalTab）と同じ操作（applyOperation）に当てる。モードは、通ったときだけ変える
      const r = applyOperation(core, { kind: 'config', uid, change: result.change }, opCtx);
      if (r.ok) {
        core = r.core;
        if (result.session !== null) sessions.set(uid, result.session);
        log.push({ line, result: 'done', ...mode });
      } else {
        log.push({ line, result: 'fail', reason: r.reason });
      }
    } else if (!(parsed as { spec?: { writes: boolean } } | null)?.spec?.writes) {
      if (result.session !== null) sessions.set(uid, result.session);
      log.push({ line, lines: result.lines.map((l) => `${l.kind}:${l.text}`), ...mode });
    } else {
      // 設定の命令の誤り（記録の形は、行ごとの結果を分けて残す）
      const [first] = result.lines;
      log.push(first.text === 'ui.terminal.noRouteToRemove' ? { line, result: 'fail', reason: first.text } : { line, result: 'error', text: first.text });
    }
  }
  const end = focusedOf(core) as Project;
  const byUid = <T extends { uid: string }>(xs: T[]) => [...xs].sort((a, b) => a.uid.localeCompare(b.uid));
  return { log, network: { nodes: byUid(end.nodes), links: byUid(end.links) } };
};

const scenes = existsSync(scenesDir) ? readdirSync(scenesDir).filter((f) => f.endsWith('.txt')).sort() : [];

// 記録に出た文言の鍵（ui. で始まるもの）と失敗の理由（ui.error.<理由>）が、言語ファイルにあること。鍵のまま画面に出る欠けを防ぐ
const langKeys = new Set(Object.keys(langJson));
const missingKeys = (log: unknown[]): string[] =>
  (log as { text?: string; lines?: string[]; reason?: string }[]).flatMap((e) => {
    const texts = [...(e.text !== undefined ? [e.text] : []), ...(e.lines ?? []).map((l) => l.replace(/^[a-z]+:/, '')), ...(e.reason !== undefined ? [e.reason.startsWith('ui.') ? e.reason : `ui.error.${e.reason}`] : [])];
    return texts.map((x) => /^ui\.[A-Za-z0-9_.]+/.exec(x)?.[0]).filter((k): k is string => k !== undefined && !langKeys.has(k));
  });

describe('命令の列の記録（設定の命令・show・ping など）', () => {
  for (const file of scenes) {
    const scene = file.replace(/\.txt$/, '');
    it(scene, async () => {
      const text = readFileSync(join(scenesDir, file), 'utf8');
      const recorded = runScene(scene, text);
      expect(missingKeys(recorded.log), '言語ファイルにない鍵').toEqual([]);
      await expect(json(recorded)).toMatchFileSnapshot(join(snapDir, `terminal-${scene}.json`));
    });
  }
});

describe('命令の一覧', () => {
  it('登録されたすべての命令が、いずれかの列で1回以上解釈される', () => {
    const interpreted = new Set<string>();
    for (const file of scenes) runScene(file.replace(/\.txt$/, ''), readFileSync(join(scenesDir, file), 'utf8'), interpreted);
    expect(COMMANDS.all().map((spec) => spec.id).filter((id) => !interpreted.has(id))).toEqual([]);
  });
});
