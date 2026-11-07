// 機器のターミナルのタブ。コマンドを1行ずつ入力し、結果を履歴に積む（コマンドは network/terminal.ts と terminalConfig.ts）。
// ↑↓で過去の入力を呼び出し、Tab で補完する。clear は表示の履歴を消す（入力の履歴は残す）。
import { useState, type KeyboardEvent } from 'react';
import { t, tDyn } from '../i18n/t';
import { completeLine, runTerminal, type TerminalLine } from '../network/terminal';
import { parseConfig, type ConfigAction } from '../network/terminalConfig';
import type { NetLink, NetNode } from '../network/types';
import { engineWithWalls, gameEnv } from '../sim/env';
import { nodeLabel } from './nodeLabel';
import { focusedProject, useGameStore } from '../stores/useGameStore';
import { secondaryButton } from './Modal';
import { warnColor } from './devicePorts';

export function TerminalTab({ node, nodes, links, readOnly }: { node: NetNode; nodes: NetNode[]; links: NetLink[]; readOnly: boolean }) {
  const state = useGameStore();
  const setIface = useGameStore((s) => s.setIface);
  const setGateway = useGameStore((s) => s.setGateway);
  const addRoute = useGameStore((s) => s.addRoute);
  const removeRoute = useGameStore((s) => s.removeRoute);
  const setHostname = useGameStore((s) => s.setHostname);
  const setHost = useGameStore((s) => s.setHost);
  const removeHost = useGameStore((s) => s.removeHost);
  const setNameServer = useGameStore((s) => s.setNameServer);
  const setRouting = useGameStore((s) => s.setRouting);
  const setBgp = useGameStore((s) => s.setBgp);
  const setNat = useGameStore((s) => s.setNat);
  const setWireless = useGameStore((s) => s.setWireless);
  const learnPing = useGameStore((s) => s.learnPing);
  const netKey = useGameStore((s) => s.focus ?? 'office');
  const arp = useGameStore((s) => s.arpTable[`${netKey}:${node.uid}`]);
  const macTable = useGameStore((s) => s.macTable[`${netKey}:${node.uid}`]);
  // 設定のコマンドを、画面の操作に当てる。失敗したら理由のキーを返す（成功なら null）
  const applyConfig = (action: ConfigAction): string | null => {
    switch (action.kind) {
      case 'iface':
        return setIface(node.uid, action.port, action.ip, action.prefix);
      case 'gateway':
        return setGateway(node.uid, action.gateway);
      case 'addRoute':
        return addRoute(node.uid, action.route);
      case 'removeRoute': {
        const index = node.routes.findIndex((r) => r.dest === action.dest && r.prefix === action.prefix);
        return index < 0 ? 'ui.terminal.noRouteToRemove' : removeRoute(node.uid, index);
      }
      case 'hostname':
        return setHostname(node.uid, action.hostname);
      case 'host':
        return setHost(node.uid, action.name, action.ip);
      case 'noHost':
        return removeHost(node.uid, action.name);
      case 'nameServer':
        return setNameServer(node.uid, action.ip);
      case 'routing':
        return setRouting(node.uid, { proto: action.proto, on: action.on });
      case 'network':
        return setRouting(node.uid, { proto: action.proto, on: action.on, ip: action.ip });
      case 'bgp':
        return setBgp(node.uid, action);
      case 'nat':
        return setNat(node.uid, action);
      case 'wireless':
        return setWireless(node.uid, action.key, action.value);
      default:
        return null;
    }
  };

  const [input, setInput] = useState('');
  const [history, setHistory] = useState<TerminalLine[]>([]);
  // 入力した行の履歴と、↑↓で今指している位置（null は新しい入力）
  const [commands, setCommands] = useState<string[]>([]);
  const [recall, setRecall] = useState<number | null>(null);

  const run = () => {
    const line = input.trim();
    if (line === '') return;
    setCommands((c) => (c[c.length - 1] === line ? c : [...c, line]));
    setRecall(null);
    setInput('');
    if (line === 'clear') {
      setHistory([]);
      return;
    }
    const tr = (key: string, params?: Record<string, string | number>) => tDyn(key, params);
    const parsed = parseConfig(line, tr);
    let out: TerminalLine[];
    if (parsed.kind === 'action') {
      if (readOnly) {
        out = [{ text: t('ui.terminal.readOnly'), kind: 'err' }];
      } else {
        const reason = applyConfig(parsed.action);
        out = reason === null ? [{ text: t('ui.terminal.done'), kind: 'out' }] : [{ text: reason.startsWith('ui.') ? tr(reason) : tr(`ui.error.${reason}`), kind: 'err' }];
      }
    } else if (parsed.kind === 'error') {
      out = [{ text: parsed.text, kind: 'err' }];
    } else {
      out = runTerminal(line, { node, nodes, links, data: engineWithWalls(gameEnv.engine, state.maps[focusedProject(state)?.contract.map ?? 'hq']), nameOf: (n) => nodeLabel(state, n, nodes), arp, macTable, onReach: (dst) => learnPing(node.uid, dst) }, tr);
    }
    setHistory((h) => [...h, { text: `> ${line}`, kind: 'out' }, ...out]);
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
      setInput(completeLine(input));
    }
  };

  return (
    <div>
      <div
        aria-live="polite"
        style={{ fontFamily: 'monospace', fontSize: 12, height: 160, overflowY: 'auto', background: '#0f1d33', padding: 6, marginBottom: 6 }}
      >
        {history.map((l, i) => (
          <div key={i} style={{ color: l.kind === 'err' ? warnColor : undefined, whiteSpace: 'pre-wrap' }}>
            {l.text}
          </div>
        ))}
      </div>
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
