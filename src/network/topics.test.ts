import { describe, expect, it } from 'vitest';
import { lessons } from 'virtual:game-data';
import ja from '../assets/lang/ja_jp.json';
import { analyze } from './engine/analyze';
import { lessonGoalResults, lessonLinks, lessonNodes } from '../sim/lesson';
import { parseConfig } from './terminalConfig';
import { runTerminal, type Tr } from './terminal';
import { TOPICS, type Topic, type TopicItem } from './topics';
import { solutions } from '../__golden__/solutions';
import type { EngineData, NetNode, NetLink } from './types';

const ALL: readonly Topic[] = TOPICS;

const engine: EngineData = { wallAt: () => false };
const text = ja as Record<string, string>;
const tr: Tr = (key) => key;

// 確かめの対象の小さな構成（PC と スイッチ）。show の命令を動かすための文脈
const pc = (uid: string, ip: string): NetNode => ({
  ports: [],
  uid,
  device: 'pc_basic',
  x: 0,
  y: 0,
  locked: false,
  configLocked: false,
  interfaces: [{ id: 'g0/0', kind: 'port', port: 0, ip, prefix: 24 }],
  gateway: null,
  routes: [],
  services: [],
  macSerial: 1,
} as NetNode);
const nodes: NetNode[] = [pc('a', '192.168.1.10')];
const links: NetLink[] = [];
const ctx = { node: nodes[0], nodes, links, data: engine };

// 項目ごとに、欠けている要素の一覧を返す（空なら揃っている）
const missingOf = (t: Topic): Record<TopicItem, string[]> => {
  const command = t.command === null ? ['（命令なし）'] : parseConfig(t.command, tr).kind === 'action' ? [] : [t.command];
  const show = t.show === null ? ['（show なし）'] : runTerminal(t.show, { ...ctx, state: analyze({ nodes, links }, engine) }, tr).some((l) => l.text.startsWith('ui.terminal.unknown')) ? [t.show] : [];
  const failures = t.failures.flatMap((id) => [`error.${id}`, `error.${id}.fix`].filter((k) => text[k] === undefined));
  const warnings = t.warnings.filter((id) => text[`warn.${id}`] === undefined).map((id) => `warn.${id}`);
  const glossary = t.glossary === null ? ['（用語なし）'] : text[`glossary.${t.glossary}`] !== undefined ? [] : [`glossary.${t.glossary}`];
  const lesson = t.lessons.length === 0 ? ['（教材なし）'] : t.lessons.flatMap((id) => {
    const l = lessons.find((x) => x.id === id);
    if (!l) return [`教材 ${id}`];
    const solve = solutions[id];
    if (!solve) return [`正解の構成 ${id}`];
    const ok = lessonGoalResults(l.goals, solve(lessonNodes(l)), lessonLinks(l), engine).every(Boolean);
    return ok ? [] : [`正解の構成で達成条件を満たさない ${id}`];
  });
  return { command, show, failures, warnings, glossary, lesson };
};

describe('論点の登録表', () => {
  it('論点の ID は重複しない', () => {
    const ids = ALL.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('known に書いた項目は、実際に欠けている（欠けを埋めたら known から外す）', () => {
    for (const t of ALL) {
      const missing = missingOf(t);
      for (const item of t.known ?? []) {
        expect(missing[item], `${t.id} の ${item} は既知の欠けのはず`).not.toEqual([]);
      }
    }
  });

  describe.each(ALL.map((t) => [t.id, t] as const))('論点 %s', (_id, t) => {
    const missing = missingOf(t);
    const known = (item: TopicItem) => (t.known ?? []).includes(item);
    const check = (item: TopicItem, label: string) => {
      if (known(item)) return;
      it(label, () => expect(missing[item]).toEqual([]));
    };
    check('command', '設定の命令がターミナルの文法にある');
    check('show', 'show の命令がターミナルにある');
    check('failures', '失敗の文言と直し方がある');
    check('warnings', '警告の文言がある');
    check('glossary', '用語集の文言がある');
    check('lesson', '教材の JSON があり、正解の構成で達成条件を満たす');
  });
});
