// 機器のターミナルのタブ。コマンドを1行ずつ入力し、結果を履歴に積む（コマンドは network/command/ の木）。
// ↑↓で過去の入力を呼び出す。入力の続きを薄い文字で予測し、→・End で全部、Ctrl+→（Option+→）で1語を確定する。
// Tab は補完（候補が複数なら一覧を出し、続けて押すと順に選ぶ）、? は打てる語の一覧。clear は表示の履歴を消す（入力の履歴は残す）。
import { useState, type KeyboardEvent } from 'react';
import { t, tDyn } from '../i18n/t';
import type { TerminalLine } from '../network/terminal';
import { completeLine } from '../network/command/complete';
import { questionLines, questionList, suggest, withWord } from '../network/command/suggest';
import { INITIAL_SESSION, promptKeyOf } from '../network/command/modes';
import { canonicalLine, commandContextOf, runLine } from '../network/command/run';
import type { NetLink, NetNode } from '../network/types';
import type { NetworkState } from '../network/public';
import { gameEnv } from '../sim/env';
import { engineWithWalls } from '../sim/walls';
import { nodeLabel } from './nodeLabel';
import { createOps } from '../stores/gameOps';
import { unlockedTopicsOf } from '../stores/gameHelpers';
import { focusedProject, useGameStore } from '../stores/useGameStore';
import { usePhone } from '../ui/usePhone';
import { Button } from './ui/Button';
import { TerminalInput } from './ui/TerminalInput';
import { TerminalOutput } from './ui/TerminalOutput';
import { Text } from './ui/Text';
import { WordList } from './ui/WordList';

const NO_LINES: TerminalLine[] = [];
const NO_COMMANDS: string[] = [];
// 設定の操作の通り道。スライスの関数と同じ dispatch を使う
const { dispatch, tileOf } = createOps(useGameStore.setState, useGameStore.getState);

export function TerminalTab({ node, nodes, links, state: netState, readOnly }: { node: NetNode; nodes: NetNode[]; links: NetLink[]; state: NetworkState; readOnly: boolean }) {
  const state = useGameStore();
  const learnPing = useGameStore((s) => s.learnPing);
  const showTrace = useGameStore((s) => s.showTrace);
  const netKey = useGameStore((s) => s.focus ?? 'office');
  const arp = useGameStore((s) => s.arpTable[`${netKey}:${node.uid}`]);
  const macTable = useGameStore((s) => s.macTable[`${netKey}:${node.uid}`]);
  const [input, setInput] = useState('');
  // 出力と命令の履歴は機器ごとにストアに持つ（画面を閉じても残る）。↑↓で今指している位置は画面の中だけで持つ（null は新しい入力）
  const history = useGameStore((s) => s.terminalLog[node.uid] ?? NO_LINES);
  const commands = useGameStore((s) => s.terminalCommands[node.uid] ?? NO_COMMANDS);
  const session = useGameStore((s) => s.terminalSession[node.uid] ?? INITIAL_SESSION);
  const [recall, setRecall] = useState<number | null>(null);
  // Tab で出した候補の一覧と、続けて押して選んでいる位置（入力が変わったら消す）
  const [tabList, setTabList] = useState<{ base: string; items: readonly string[]; index: number } | null>(null);
  const phone = usePhone();
  // 教材の中では引数の値を出さない
  const hideValues = useGameStore((s) => s.sandboxLesson !== null);
  // 予測に使う全機器の履歴
  const allCommands = useGameStore((s) => s.terminalCommands);

  const contextOf = () => commandContextOf({
    node,
    nodes,
    links,
    data: engineWithWalls(gameEnv.engine, state.maps[focusedProject(state)?.contract.map ?? 'hq']),
    state: netState,
    nameOf: (n) => nodeLabel(state, n, nodes),
    arp,
    macTable,
    onReach: (dst) => learnPing(node.uid, dst),
    onTrace: showTrace,
  }, readOnly, session, { unlocked: (topic) => unlockedTopicsOf(state).has(topic), hideValues });

  const viewCtx = contextOf();
  // 同じ機器の履歴を、ほかの機器の履歴より後ろ（優先）に並べる
  const others = Object.entries(allCommands).filter(([uid]) => uid !== node.uid).flatMap(([, lines]) => lines);
  const suggestion = suggest(input, viewCtx, [...others, ...commands]);
  const translate = (key: string) => tDyn(key);

  const run = () => {
    const line = input.trim();
    if (line === '') return;
    // 履歴と教材の記録には、略記を展開した正式な形を残す
    const canonical = canonicalLine(line, session);
    useGameStore.getState().recordTerminalCommand(node.uid, canonical);
    setRecall(null);
    setTabList(null);
    setInput('');
    useGameStore.getState().recordLessonCommand(canonical);
    if (line === 'clear') {
      useGameStore.getState().clearTerminalLog(node.uid);
      return;
    }
    const tr = (key: string, params?: Record<string, string | number>) => tDyn(key, params);
    const result = runLine(line, viewCtx, tr);
    let out: readonly TerminalLine[];
    if (result.change === null) {
      out = result.lines;
      if (result.session !== null) useGameStore.getState().setTerminalSession(node.uid, result.session);
    } else {
      // 設定の操作は、画面の操作と同じ通り道（dispatch）で世界に当てる。失敗したら理由のキー
      const reason = dispatch({ kind: 'config', uid: node.uid, change: result.change }, tileOf(node.uid));
      // モードを変える設定の命令（router ospf 1 など）は、設定が通ったときだけモードを変える
      if (reason === null && result.session !== null) useGameStore.getState().setTerminalSession(node.uid, result.session);
      out = reason === null ? [{ text: t('ui.terminal.done'), kind: 'out' }] : [{ text: reason.startsWith('ui.') ? tr(reason) : tr(`ui.error.${reason}`), kind: 'err' }];
    }
    useGameStore.getState().appendTerminal(node.uid, [{ text: `> ${line}`, kind: 'out' }, ...out]);
  };

  const changeInput = (value: string) => {
    setInput(value);
    setRecall(null);
    setTabList(null);
  };

  // Tab: 候補が1つなら補完、共通の続きがあればそこまで補完、なければ一覧を出す。続けて押すと一覧を順に選ぶ
  const tab = () => {
    if (tabList !== null) {
      const index = (tabList.index + 1) % tabList.items.length;
      setTabList({ ...tabList, index });
      setInput(withWord(tabList.base, tabList.items[index]));
      return;
    }
    const completed = completeLine(input, viewCtx);
    if (completed !== input) {
      setInput(completed);
      return;
    }
    if (suggestion.candidates.length > 1) setTabList({ base: input, items: suggestion.candidates.map((c) => c.word), index: -1 });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (commands.length === 0) return;
      if (e.key === 'ArrowUp') {
        const next = recall === null ? commands.length - 1 : Math.max(0, recall - 1);
        setRecall(next);
        setInput(commands[next]);
      } else if (recall !== null) {
        const next = recall + 1;
        if (next >= commands.length) {
          setRecall(null);
          setInput('');
        } else {
          setRecall(next);
          setInput(commands[next]);
        }
      }
    } else if (e.key === 'Tab') {
      // ゲーム全体の「次の入力へ」に渡さず、補完だけに使う
      e.preventDefault();
      e.stopPropagation();
      tab();
    } else if (e.key === '?') {
      // 入力は変えず、その位置に打てる語の一覧を出す
      e.preventDefault();
      const lines = questionLines(questionList(input, viewCtx), translate);
      useGameStore.getState().appendTerminal(node.uid, [{ text: `> ${input}?`, kind: 'out' }, ...lines.map((text) => ({ text, kind: 'out' as const }))]);
    } else if ((e.key === 'ArrowRight' || e.key === 'End') && suggestion.ghost !== '' && e.currentTarget.selectionStart === input.length) {
      e.preventDefault();
      // Ctrl+→（Mac は Option+→）は次の1語だけ、→・End は全部を確定する
      const piece = e.key === 'ArrowRight' && (e.ctrlKey || e.altKey) ? (/^\s*\S+\s?/.exec(suggestion.ghost)?.[0] ?? suggestion.ghost) : suggestion.ghost;
      changeInput(input + piece);
    }
  };

  const hasTraces = useGameStore((s) => s.traces.length > 0);
  const openWindow = useGameStore((s) => s.openWindow);
  return (
    <div>
      <TerminalOutput lines={history.map((l) => ({ text: l.text, warn: l.kind === 'err' }))} />
      {hasTraces && (
        <Button variant="secondary" layout={{ marginBottom: 6 }} onClick={() => openWindow('frames', '')}>
          {t('ui.frames.open')}
        </Button>
      )}
      {tabList !== null && <WordList words={tabList.items} selected={tabList.index} />}
      {phone && suggestion.candidates.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {suggestion.candidates.slice(0, 5).map((c) => (
            <Button key={c.word} variant="secondary" size="s" onClick={() => changeInput(`${withWord(input, c.word)} `)}>
              {c.word}
            </Button>
          ))}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
        style={{ display: 'flex', gap: 6 }}
      >
        {/* プロンプト: ホスト名（なければ画面の名前）とモード */}
        <Text as="span" mono size="sm" layout={{ alignSelf: 'center' }}>{tDyn(promptKeyOf(session.mode), { name: node.hostname ?? nodeLabel(state, node, nodes) })}</Text>
        <TerminalInput value={input} ghost={suggestion.ghost} errorAt={suggestion.errorAt} onChange={changeInput} onKeyDown={onKeyDown} label={t('ui.terminal.input')} placeholder="help" />
        {phone && suggestion.ghost !== '' && (
          <Button variant="secondary" label={t('ui.terminal.acceptGhost')} onClick={() => changeInput(input + suggestion.ghost)}>
            →
          </Button>
        )}
        <Button variant="secondary" type="submit">
          {t('ui.terminal.run')}
        </Button>
      </form>
    </div>
  );
}
