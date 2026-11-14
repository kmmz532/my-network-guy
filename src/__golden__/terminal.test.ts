// 命令の列の記録: 場面（教材の初期の構成）ごとに、設定の命令の列を1行ずつ流し、各行の出力と、流し終えた後の構成（保存の形）を記録する。
// 命令の列は src/__golden__/terminal/<場面>.txt に置く。ターミナルが受け付ける命令の語は、ターミナルのソースから集め、いずれかの列に出ることを確かめる
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lessons } from 'virtual:game-data';
import { gameEnv } from '../sim/env';
import { lessonLinks, lessonNodes, lessonPlans } from '../sim/lesson';
import { focusedOf, fail, type Core, type Outcome, type Project } from '../sim/project';
import { applyOperation, type OpContext } from '../world/apply';
import type { ConfigChange } from '../world/operation';
import type { GameMap } from '../data/schema';
import officeSmall from '../assets/data/maps/office_small.json';
import { analyze } from '../network/engine/analyze';
import { runTerminal } from '../network/terminal';
import { parseConfig, type ConfigAction } from '../network/terminalConfig';
import type { NetLink, NetNode } from '../network/types';

const snapDir = join(import.meta.dirname, 'snap');
const scenesDir = join(import.meta.dirname, 'terminal');
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
// 文言を引かず、キーと引数をそのまま並べる（言語ファイルの文言の変更で記録が変わらないようにする）
const tr = (key: string, params?: Record<string, string | number>): string => (params ? `${key} ${JSON.stringify(params)}` : key);

// 設定の操作は焦点の案件を対象にする。地図は設定の操作では使わない
const ctx: OpContext = { env: gameEnv, target: 'focus', map: null, hq: officeSmall as unknown as GameMap, mode: 'career' };
const change = (core: Core, uid: string, c: ConfigChange): Outcome => applyOperation(core, { kind: 'config', uid, change: c }, ctx);

// 命令の列の1行を、設定の画面（TerminalTab）と同じ操作に当てる。モードは持たないため、口の番号は行の中で指定する。
// 画面の部品は使わず、操作（applyOperation）を直接当てる
const applyAction = (core: Core, uid: string, action: ConfigAction, node: NetNode): Outcome => {
  switch (action.kind) {
    case 'iface':
      return change(core, uid, { kind: 'iface', port: action.port, ip: action.ip, prefix: action.prefix });
    case 'svi':
      return change(core, uid, { kind: 'svi', vlan: action.vlan, ip: action.ip, prefix: action.prefix });
    case 'portMode':
      return change(core, uid, { kind: 'portMode', port: action.port, mode: action.mode });
    case 'gateway':
      return change(core, uid, { kind: 'gateway', gateway: action.gateway });
    case 'addRoute':
      return change(core, uid, { kind: 'addRoute', route: action.route });
    case 'removeRoute': {
      const index = node.routes.findIndex((r) => r.dest === action.dest && r.prefix === action.prefix);
      return index < 0 ? fail('ui.terminal.noRouteToRemove') : change(core, uid, { kind: 'removeRoute', index });
    }
    case 'hostname':
      return change(core, uid, { kind: 'hostname', hostname: action.hostname });
    case 'host':
      return change(core, uid, { kind: 'host', name: action.name, ip: action.ip });
    case 'noHost':
      return change(core, uid, { kind: 'removeHost', name: action.name });
    case 'nameServer':
      return change(core, uid, { kind: 'nameServer', ip: action.ip });
    case 'routing':
      return change(core, uid, { kind: 'routing', change: { proto: action.proto, on: action.on } });
    case 'network':
      return change(core, uid, { kind: 'routing', change: { proto: action.proto, on: action.on, ip: action.ip, ...(action.area !== null ? { area: action.area } : {}) } });
    case 'ospf': {
      if (action.op !== 'iface') return change(core, uid, { kind: 'ospf', change: action });
      const iface = node.interfaces.find((i) => i.port === action.port);
      return change(core, uid, { kind: 'ospf', change: { op: 'iface', id: iface?.id ?? '', key: action.key, value: action.value } });
    }
    case 'bgp':
      return change(core, uid, { kind: 'bgp', change: action });
    case 'stp':
      return change(core, uid, { kind: 'stp', change: action });
    case 'dhcp':
      return change(core, uid, { kind: 'dhcp', change: action });
    case 'channel':
      return change(core, uid, { kind: 'channel', change: action });
    case 'vrrp': {
      const idOf = (port: number) => node.interfaces.find((i) => i.port === port)?.id ?? '';
      const id = idOf(action.port);
      if (action.op === 'ip') return change(core, uid, { kind: 'vrrp', change: { op: 'ip', id, vrid: action.vrid, ip: action.ip } });
      if (action.op === 'priority') return change(core, uid, { kind: 'vrrp', change: { op: 'priority', id, vrid: action.vrid, value: action.value } });
      if (action.op === 'preempt') return change(core, uid, { kind: 'vrrp', change: { op: 'preempt', id, vrid: action.vrid, on: action.on } });
      if (action.op === 'track') return change(core, uid, { kind: 'vrrp', change: { op: 'track', id, vrid: action.vrid, iface: idOf(action.trackPort), decrement: action.decrement } });
      return change(core, uid, { kind: 'vrrp', change: { op: 'remove', id, vrid: action.vrid } });
    }
    case 'nat': {
      if (action.op !== 'iface') return change(core, uid, { kind: 'nat', change: action });
      const iface = node.interfaces.find((i) => i.port === action.port);
      return change(core, uid, { kind: 'nat', change: { op: 'iface', id: iface?.id ?? '', nat: action.nat } });
    }
    case 'wireless':
      return change(core, uid, { kind: 'wireless', key: action.key, value: action.value });
  }
};

// 場面の命令の列を流す。@ の行で機器を選び、それ以外の行を1つの命令として流す
const runScene = (lessonId: string, text: string) => {
  const lesson = lessons.find((l) => l.id === lessonId);
  if (!lesson) throw new Error(`教材 ${lessonId} がない`);
  const nodes = lessonNodes(lesson);
  const links: NetLink[] = lessonLinks(lesson);
  const segments = lessonPlans(nodes, links, gameEnv.engine);
  // 教材の構成を、設計中の案件として持つ（設定の操作は焦点の案件を対象にする）
  const project = { id: 'p', kind: 'fixed', baseId: lessonId, params: {}, nodes, links, segments, seq: nodes.length + 1, testedOk: false, built: { nodes: [], links: [] }, inheritedLinks: [], phase: 'design', contract: { inhouse: false, map: 'hq', furniture: [] } } as unknown as Project;
  let core = { active: [project], focus: 'p', owned: {} } as unknown as Core;
  let uid = '';
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
    const parsed = parseConfig(line, tr);
    if (parsed.kind === 'action') {
      const r = applyAction(core, uid, parsed.action, node);
      if (r.ok) {
        core = r.core;
        log.push({ line, result: 'done' });
      } else {
        log.push({ line, result: 'fail', reason: r.reason });
      }
    } else if (parsed.kind === 'error') {
      log.push({ line, result: 'error', text: parsed.text });
    } else {
      const state = analyze({ nodes: current.nodes, links: current.links, plans: current.plans }, gameEnv.engine);
      const out = runTerminal(line, { node, nodes: current.nodes, links: current.links, data: gameEnv.engine, state }, tr);
      log.push({ line, lines: out.map((l) => `${l.kind}:${l.text}`) });
    }
  }
  const end = focusedOf(core) as Project;
  const byUid = <T extends { uid: string }>(xs: T[]) => [...xs].sort((a, b) => a.uid.localeCompare(b.uid));
  return { log, network: { nodes: byUid(end.nodes), links: byUid(end.links) } };
};

const scenes = existsSync(scenesDir) ? readdirSync(scenesDir).filter((f) => f.endsWith('.txt')).sort() : [];

describe('命令の列の記録（設定の命令・show・ping など）', () => {
  for (const file of scenes) {
    const scene = file.replace(/\.txt$/, '');
    it(scene, async () => {
      const text = readFileSync(join(scenesDir, file), 'utf8');
      await expect(json(runScene(scene, text))).toMatchFileSnapshot(join(snapDir, `terminal-${scene}.json`));
    });
  }
});

// ターミナルが受け付ける命令の語を、ターミナルのソース（terminal.ts・terminalConfig.ts）の比較と略記の表から集める
const keywordsOfSource = (): string[] => {
  const src = ['terminal.ts', 'terminalConfig.ts'].map((f) => readFileSync(join(import.meta.dirname, '..', 'network', f), 'utf8')).join('\n');
  const compared = [...src.matchAll(/(?:===|!==)\s*'([a-z][a-z0-9 -]*)'/g)].map((m) => m[1]);
  const keyed = [...src.matchAll(/'([a-z][a-z0-9-]*)':/g)].map((m) => m[1]);
  // 命令の語ではない比較の値（接続の状態）は除く
  const notCommand = new Set(['established']);
  return [...new Set([...compared, ...keyed])].filter((w) => !notCommand.has(w)).sort();
};

describe('命令の一覧', () => {
  it('ターミナルが受け付けるすべての命令の語が、いずれかの列に1回以上出る', () => {
    const lines = scenes.flatMap((f) => readFileSync(join(scenesDir, f), 'utf8').split('\n')).map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#')).map((l) => ` ${l} `);
    const missing = keywordsOfSource().filter((w) => !lines.some((l) => l.includes(` ${w} `)));
    expect(missing).toEqual([]);
  });
});
