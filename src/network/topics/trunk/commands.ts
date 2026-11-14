// トランクの論点の命令。口を trunk にし、通す VLAN（allowed）と native の VLAN を決める。
import { vlanListOf } from '../../command/args';
import { changed, err, shown } from '../../command/lines';
import type { CommandContext, CommandResult, CommandSpec, Token } from '../../command/types';
import type { Tr } from '../../terminal';
import { interfaceOf, sessionPortOf } from '../../command/modes';

// 語の一覧（allowed の値）を番号の並びに直す。型の検査を通った語にだけ使う
const listOf = (text: string): number[] => {
  const list = vlanListOf(text);
  if (list === null) throw new Error(`VLAN の一覧の形でない: ${text}`);
  return list;
};

// allowed が all のときは null（すべて通す）。省略された項目は、モードに書かない
const trunk = (ctx: CommandContext, tr: Tr, port: string, allowed?: string, native?: string): CommandResult =>
  changed(ctx, tr, {
    kind: 'portMode',
    port: Number(port),
    mode: {
      kind: 'trunk',
      ...(allowed === undefined ? {} : { allowed: allowed === 'all' ? null : listOf(allowed) }),
      ...(native === undefined ? {} : { native: Number(native) }),
    },
  });

const PORT = { arg: 'number', name: 'port' } as const;
const ALLOWED = { arg: 'vlanList', name: 'allowed' } as const;
const NATIVE = { arg: 'vlan', name: 'native' } as const;
const ALL = { word: 'all' } as const;

// 命令の形（exec・config）。口の番号を行に書く。許可の一覧・native の順に並ぶ
const exec: readonly CommandSpec[] = [
  {
    id: 'trunk.switchportTrunk',
    modes: ['exec', 'config'],
    tokens: [{ word: 'switchport' }, PORT, { word: 'trunk' }],
    help: '',
    writes: true,
    topic: 'trunk',
    run: (a, ctx, tr) => trunk(ctx, tr, a.port),
  },
  {
    id: 'trunk.switchportTrunkAllowed',
    modes: ['exec', 'config'],
    tokens: [{ word: 'switchport' }, PORT, { word: 'trunk' }, { word: 'allowed' }, ALLOWED],
    help: '',
    writes: true,
    topic: 'trunk',
    run: (a, ctx, tr) => trunk(ctx, tr, a.port, a.allowed),
  },
  {
    id: 'trunk.switchportTrunkAllowedAll',
    modes: ['exec', 'config'],
    tokens: [{ word: 'switchport' }, PORT, { word: 'trunk' }, { word: 'allowed' }, ALL],
    help: '',
    writes: true,
    topic: 'trunk',
    run: (a, ctx, tr) => trunk(ctx, tr, a.port, 'all'),
  },
  {
    id: 'trunk.switchportTrunkNative',
    modes: ['exec', 'config'],
    tokens: [{ word: 'switchport' }, PORT, { word: 'trunk' }, { word: 'native' }, NATIVE],
    help: '',
    writes: true,
    topic: 'trunk',
    run: (a, ctx, tr) => trunk(ctx, tr, a.port, undefined, a.native),
  },
  {
    id: 'trunk.switchportTrunkAllowedNative',
    modes: ['exec', 'config'],
    tokens: [{ word: 'switchport' }, PORT, { word: 'trunk' }, { word: 'allowed' }, ALLOWED, { word: 'native' }, NATIVE],
    help: '',
    writes: true,
    topic: 'trunk',
    run: (a, ctx, tr) => trunk(ctx, tr, a.port, a.allowed, a.native),
  },
  {
    id: 'trunk.switchportTrunkAllowedAllNative',
    modes: ['exec', 'config'],
    tokens: [{ word: 'switchport' }, PORT, { word: 'trunk' }, { word: 'allowed' }, ALL, { word: 'native' }, NATIVE],
    help: '',
    writes: true,
    topic: 'trunk',
    run: (a, ctx, tr) => trunk(ctx, tr, a.port, 'all', a.native),
  },
];

// interface モードの形は、口の番号を外し、allowed と native の後ろに vlan の語を入れる（switchport trunk allowed vlan <一覧>）
const withVlanWord = (tokens: readonly Token[]): Token[] =>
  tokens.filter((t) => !('arg' in t && t.name === 'port')).flatMap((t) => ('word' in t && (t.word === 'allowed' || t.word === 'native') ? [t, { word: 'vlan' }] : [t]));

const modeTrunk: CommandSpec = {
  id: 'trunk.switchportModeTrunk',
  modes: ['interface'],
  tokens: [{ word: 'switchport' }, { word: 'mode' }, { word: 'trunk' }],
  help: '',
  writes: true,
  topic: 'trunk',
  // trunk は今の許可・native のまま、モードだけ替える
  run: (_args, ctx, tr) => {
    const port = sessionPortOf(ctx);
    if (port === null) return shown([err(tr('ui.terminal.errIfaceKind'))]);
    return changed(ctx, tr, { kind: 'portMode', port, mode: { kind: 'trunk' } });
  },
};

export const commands: readonly CommandSpec[] = [
  ...exec,
  ...exec.map((s) => interfaceOf(s, withVlanWord(s.tokens))),
  modeTrunk,
];
