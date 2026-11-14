// 入力の行を実行する。木（COMMANDS）で解釈できる行は、その命令の run を呼ぶ。
// 木で解釈できない行は、今のターミナルの解釈（parseConfig → runTerminal）に渡す。
import type { ConfigChange } from '../../company/operation';
import { runTerminal, type Tr } from '../terminal';
import { parseConfig, type ConfigAction } from '../terminalConfig';
import type { NetNode } from '../types';
import { err, readOnlyLine, shown } from './lines';
import { parseLine } from './parse';
import type { CommandContext, CommandResult, TerminalContext } from './types';

// 画面・試験が持つ文脈に、命令の木が要る項目を足す。モードは常に exec とし、論点はすべて解放して値を隠さない
export const commandContextOf = (base: TerminalContext, readOnly: boolean): CommandContext => ({
  ...base,
  session: { mode: 'exec', iface: null, process: null },
  unlocked: () => true,
  hideValues: false,
  readOnly,
});

// 設定の命令（ConfigAction）を、世界へ渡す設定の操作に替える。替えられないときは誤りの鍵を返す。
// ターミナルの書き方は口の番号のままなので、インターフェースの id で指定する操作へは、機器の口から引いて替える
export const legacyChange = (action: ConfigAction, node: NetNode): ConfigChange | string => {
  const idOf = (port: number) => node.interfaces.find((i) => i.port === port)?.id ?? '';
  switch (action.kind) {
    case 'iface':
      return { kind: 'iface', port: action.port, ip: action.ip, prefix: action.prefix };
    case 'svi':
      return { kind: 'svi', vlan: action.vlan, ip: action.ip, prefix: action.prefix };
    case 'portMode':
      return { kind: 'portMode', port: action.port, mode: action.mode };
    case 'gateway':
      return { kind: 'gateway', gateway: action.gateway };
    case 'addRoute':
      return { kind: 'addRoute', route: action.route };
    case 'removeRoute': {
      const index = node.routes.findIndex((r) => r.dest === action.dest && r.prefix === action.prefix);
      return index < 0 ? 'ui.terminal.noRouteToRemove' : { kind: 'removeRoute', index };
    }
    case 'hostname':
      return { kind: 'hostname', hostname: action.hostname };
    case 'host':
      return { kind: 'host', name: action.name, ip: action.ip };
    case 'noHost':
      return { kind: 'removeHost', name: action.name };
    case 'nameServer':
      return { kind: 'nameServer', ip: action.ip };
    case 'routing':
      return { kind: 'routing', change: { proto: action.proto, on: action.on } };
    case 'network':
      return { kind: 'routing', change: { proto: action.proto, on: action.on, ip: action.ip, ...(action.area !== null ? { area: action.area } : {}) } };
    case 'ospf':
      return action.op === 'iface'
        ? { kind: 'ospf', change: { op: 'iface', id: idOf(action.port), key: action.key, value: action.value } }
        : { kind: 'ospf', change: action };
    case 'bgp':
      return { kind: 'bgp', change: action };
    case 'stp':
      return { kind: 'stp', change: action };
    case 'dhcp':
      return { kind: 'dhcp', change: action };
    case 'channel':
      return { kind: 'channel', change: action };
    case 'vrrp': {
      const id = idOf(action.port);
      if (action.op === 'ip') return { kind: 'vrrp', change: { op: 'ip', id, vrid: action.vrid, ip: action.ip } };
      if (action.op === 'priority') return { kind: 'vrrp', change: { op: 'priority', id, vrid: action.vrid, value: action.value } };
      if (action.op === 'preempt') return { kind: 'vrrp', change: { op: 'preempt', id, vrid: action.vrid, on: action.on } };
      if (action.op === 'track') return { kind: 'vrrp', change: { op: 'track', id, vrid: action.vrid, iface: idOf(action.trackPort), decrement: action.decrement } };
      return { kind: 'vrrp', change: { op: 'remove', id, vrid: action.vrid } };
    }
    case 'nat':
      return action.op === 'iface'
        ? { kind: 'nat', change: { op: 'iface', id: idOf(action.port), nat: action.nat } }
        : { kind: 'nat', change: action };
    case 'wireless':
      return { kind: 'wireless', key: action.key, value: action.value };
    default: {
      const never: never = action;
      throw new Error(`未対応の設定の命令: ${JSON.stringify(never)}`);
    }
  }
};

export const runLine = (line: string, ctx: CommandContext, tr: Tr): CommandResult => {
  const parsed = parseLine(line, ctx.session);
  if (parsed !== null) {
    if (!('error' in parsed)) return parsed.spec.run(parsed.args, ctx, tr);
    if (parsed.error === 'ambiguous') return shown([err(tr('ui.terminal.ambiguous'))]);
    throw new Error(`未対応の解釈の誤り: ${parsed.error}`);
  }
  // 木で解釈できない行。設定の命令は操作に替え、それ以外は確認の命令の解釈に渡す
  const config = parseConfig(line, tr);
  if (config.kind === 'error') return shown([err(config.text)]);
  if (config.kind === 'action') {
    // 構文の検査の後で、読み取り専用を見る（今の順序）
    if (ctx.readOnly) return shown([readOnlyLine(tr)]);
    const change = legacyChange(config.action, ctx.node);
    return typeof change === 'string' ? shown([err(tr(change))]) : { lines: [], change, session: null };
  }
  return shown(runTerminal(line, tr));
};
