// MTU の論点の命令。口の MTU と、ip tcp adjust-mss（HTTP の大きさを 値 + 40 に抑える）。値の範囲は、操作を当てる側（netEdit）が検査する。
import { changed } from '../../command/lines';
import type { CommandSpec } from '../../command/types';
import { interfaceOf } from '../../command/modes';

const PORT = { arg: 'number', name: 'port' } as const;
const VALUE = { arg: 'number', name: 'value' } as const;

// ip mtu <口> <値>（interface モードの形は口の番号を外す）
const ipMtu: CommandSpec = {
  id: 'mtu.ipMtu',
  modes: ['exec', 'config'],
  tokens: [{ word: 'ip' }, { word: 'mtu' }, PORT, VALUE],
  help: 'ui.cmd.mtu.ipMtu',
  writes: true,
  topic: 'mtu',
  run: (args, ctx, tr) => changed(ctx, tr, { kind: 'ifaceTune', port: Number(args.port), key: 'mtu', value: Number(args.value) }),
};

// ip tcp adjust-mss <口> <値>
const adjustMss: CommandSpec = {
  id: 'mtu.ipTcpAdjustMss',
  modes: ['exec', 'config'],
  tokens: [{ word: 'ip' }, { word: 'tcp' }, { word: 'adjust-mss' }, PORT, VALUE],
  help: 'ui.cmd.mtu.ipTcpAdjustMss',
  writes: true,
  topic: 'mtu',
  run: (args, ctx, tr) => changed(ctx, tr, { kind: 'ifaceTune', port: Number(args.port), key: 'adjustMss', value: Number(args.value) }),
};

export const commands: readonly CommandSpec[] = [
  ipMtu,
  interfaceOf(ipMtu),
  // mtu <値>（interface モード。ip mtu と同じ扱い）
  { ...interfaceOf(ipMtu, [{ word: 'mtu' }, VALUE]), id: 'mtu.mtuInterface', help: 'ui.cmd.mtu.mtuInterface' },
  adjustMss,
  interfaceOf(adjustMss),
];
