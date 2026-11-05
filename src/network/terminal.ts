// 機器のターミナルのコマンド。入力の行を受け取り、出力の行を返す（画面には出さない純粋な関数）。
// 対応するコマンドは help・show ip・ping の3つだけ。文言は tr（言語ファイルの引き当て）で作る。
import { ping } from './engine';
import type { EngineData, NetLink, NetNode } from './types';

export interface TerminalContext {
  node: NetNode;
  nodes: NetNode[];
  links: NetLink[];
  data: EngineData;
}

export type Tr = (key: string, params?: Record<string, string | number>) => string;

export interface TerminalLine {
  text: string;
  // err は失敗の行（画面で色を変える）
  kind: 'out' | 'err';
}

export const runTerminal = (line: string, ctx: TerminalContext, tr: Tr): TerminalLine[] => {
  const words = line.trim().split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return [];
  const out = (text: string): TerminalLine => ({ text, kind: 'out' });
  const err = (text: string): TerminalLine => ({ text, kind: 'err' });
  const [cmd, ...args] = words;

  if (cmd === 'help') return [out(tr('ui.terminal.help'))];

  if (cmd === 'show' && args[0] === 'ip' && args.length === 1) {
    const { node } = ctx;
    if (node.interfaces.length === 0) return [out(tr('ui.terminal.noIp'))];
    const lines = node.interfaces.map((i) => out(tr('ui.terminal.ifLine', { port: i.port, ip: i.ip, prefix: i.prefix })));
    if (node.gateway) lines.push(out(tr('ui.terminal.gateway', { gateway: node.gateway })));
    return lines;
  }

  if (cmd === 'ping') {
    if (args.length !== 1) return [err(tr('ui.terminal.usagePing'))];
    const ip = args[0];
    const target = ctx.nodes.find((n) => n.interfaces.some((i) => i.ip === ip));
    if (!target) return [err(tr('ui.terminal.noHost', { ip }))];
    const result = ping({ nodes: ctx.nodes, links: ctx.links }, ctx.data, ctx.node.uid, target.uid);
    if (result.ok) return [out(tr('ui.terminal.pingOk', { ip }))];
    const reason = result.failure?.reason ?? 'route.none';
    return [err(tr('ui.terminal.pingNg')), err(tr(`error.${reason}`))];
  }

  return [err(tr('ui.terminal.unknown', { cmd }))];
};
