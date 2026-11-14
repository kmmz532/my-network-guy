// 機器のターミナルのタブ。コマンドを1行ずつ入力し、結果を履歴に積む（コマンドは network/command/ の木）。
// ↑↓で過去の入力を呼び出し、Tab で補完する。clear は表示の履歴を消す（入力の履歴は残す）。
import { useState, type KeyboardEvent } from 'react';
import { t, tDyn } from '../i18n/t';
import type { TerminalLine } from '../network/terminal';
import { completeLine } from '../network/command/complete';
import { commandContextOf, runLine } from '../network/command/run';
import type { NetLink, NetNode } from '../network/types';
import type { NetworkState } from '../network/public';
import { gameEnv } from '../sim/env';
import { engineWithWalls } from '../sim/walls';
import { nodeLabel } from './nodeLabel';
import { createOps } from '../stores/gameOps';
import { focusedProject, useGameStore } from '../stores/useGameStore';
import { secondaryButton } from './Modal';
import { warnColor } from './devicePorts';

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
  const [recall, setRecall] = useState<number | null>(null);

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
  }, readOnly);

  const run = () => {
    const line = input.trim();
    if (line === '') return;
    useGameStore.getState().recordTerminalCommand(node.uid, line);
    setRecall(null);
    setInput('');
    useGameStore.getState().recordLessonCommand(line);
    if (line === 'clear') {
      useGameStore.getState().clearTerminalLog(node.uid);
      return;
    }
    const tr = (key: string, params?: Record<string, string | number>) => tDyn(key, params);
    const result = runLine(line, contextOf(), tr);
    let out: readonly TerminalLine[];
    if (result.change === null) {
      out = result.lines;
    } else {
      // 設定の操作は、画面の操作と同じ通り道（dispatch）で世界に当てる。失敗したら理由のキー
      const reason = dispatch({ kind: 'config', uid: node.uid, change: result.change }, tileOf(node.uid));
      out = reason === null ? [{ text: t('ui.terminal.done'), kind: 'out' }] : [{ text: reason.startsWith('ui.') ? tr(reason) : tr(`ui.error.${reason}`), kind: 'err' }];
    }
    useGameStore.getState().appendTerminal(node.uid, [{ text: `> ${line}`, kind: 'out' }, ...out]);
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
      setInput(completeLine(input, contextOf()));
    }
  };

  const hasTraces = useGameStore((s) => s.traces.length > 0);
  const openWindow = useGameStore((s) => s.openWindow);
  return (
    <div>
      <div
        aria-live="polite"
        data-terminal-output
        style={{ fontFamily: 'monospace', fontSize: 12, height: 160, overflowY: 'auto', background: '#0f1d33', padding: 6, marginBottom: 6 }}
      >
        {history.map((l, i) => (
          <div key={i} style={{ color: l.kind === 'err' ? warnColor : undefined, whiteSpace: 'pre-wrap' }}>
            {l.text}
          </div>
        ))}
      </div>
      {hasTraces && (
        <button type="button" style={{ ...secondaryButton, marginBottom: 6 }} onClick={() => openWindow('frames', '')}>
          {t('ui.frames.open')}
        </button>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
        style={{ display: 'flex', gap: 6 }}
      >
        {/* ホスト名を付けたら、プロンプトとして入力の前に出す（N46） */}
        {node.hostname && <span style={{ fontFamily: 'monospace', fontSize: 13, alignSelf: 'center' }}>{tDyn('ui.terminal.prompt', { name: node.hostname })}</span>}
        <input
          aria-label={t('ui.terminal.input')}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setRecall(null);
          }}
          onKeyDown={onKeyDown}
          placeholder="help"
          style={{ flex: 1, minWidth: 0, fontFamily: 'monospace', fontSize: 13, background: '#0f1d33', color: 'inherit', border: 'none', padding: 4 }}
        />
        <button type="submit" style={secondaryButton}>
          {t('ui.terminal.run')}
        </button>
      </form>
    </div>
  );
}
