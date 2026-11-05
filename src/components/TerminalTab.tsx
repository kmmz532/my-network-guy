// 機器のターミナルのタブ。コマンドを1行ずつ入力し、結果を履歴に積む（コマンドは network/terminal.ts）。
import { useState } from 'react';
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import { runTerminal, type TerminalLine } from '../network/terminal';
import type { NetLink, NetNode } from '../network/types';
import { gameEnv } from '../sim/env';
import { secondaryButton } from './Modal';
import { warnColor } from './devicePorts';

export function TerminalTab({ node, nodes, links }: { node: NetNode; nodes: NetNode[]; links: NetLink[] }) {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<TerminalLine[]>([]);
  const run = () => {
    const line = input.trim();
    if (line === '') return;
    const out = runTerminal(line, { node, nodes, links, data: gameEnv.engine }, (key, params) => t(key as LangKey, params));
    setHistory((h) => [...h, { text: `> ${line}`, kind: 'out' }, ...out]);
    setInput('');
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
        <input
          aria-label={t('ui.terminal.input')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
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
