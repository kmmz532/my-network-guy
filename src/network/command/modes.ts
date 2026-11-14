// モードの命令に使う小さな部品。interface モードの命令は、口の番号を行に書かない形を、今の口の番号つきの形に直して、同じ命令の run に渡す。
import { err, shown } from './lines';
import type { CommandContext, CommandResult, CommandSpec, Mode, TerminalSession, Token } from './types';

export const INITIAL_SESSION: TerminalSession = { mode: 'exec', iface: null, process: null };

// config の中のモード（interface・router-*）。config の命令は、これらのモードでも使う
export const SUB_MODES: readonly Mode[] = ['interface', 'router-rip', 'router-ospf', 'router-bgp'];

export const wordsOf = (text: string): string[] => text.split(' ').filter((w) => w !== '');

// interface モードの対象の口の番号。SVI を対象にしているときは null。interface モードで対象がないのは、モードの作り方の誤り
export const sessionPortOf = (ctx: CommandContext): number | null => {
  const { iface } = ctx.session;
  if (iface === null) throw new Error(`interface モードに対象がない: ${ctx.session.mode}`);
  return iface.kind === 'port' ? iface.port : null;
};

// base（口の番号を行に書く形の命令）の、interface モードの形を作る。form は、行の語を口の番号つきの語に直す
export const interfaceForm = (base: CommandSpec, form: (words: string[], port: number) => string[]): CommandSpec => ({
  ...base,
  id: `${base.id}Interface`,
  modes: ['interface'],
  run: (args, ctx, tr) => {
    const port = sessionPortOf(ctx);
    if (port === null) return shown([err(tr('ui.terminal.errIfaceKind'))]);
    return base.run({ ...args, args: form(wordsOf(args.args), port).join(' ') }, ctx, tr);
  },
});

// 口の番号を行に書く形（exec・config）の命令の、interface モードの形。口の番号の語（{ arg: 'number', name: 'port' }）を外した tokens で、
// 今の口の番号を port に入れて base の run に渡す。tokens を省略すると、口の番号の語を外したものを使う
export const interfaceOf = (base: CommandSpec, tokens: readonly Token[] = base.tokens.filter((t) => !('arg' in t && t.name === 'port'))): CommandSpec => ({
  ...base,
  id: `${base.id}Interface`,
  modes: ['interface'],
  tokens,
  run: (args, ctx, tr) => {
    const port = sessionPortOf(ctx);
    if (port === null) return shown([err(tr('ui.terminal.errIfaceKind'))]);
    return base.run({ ...args, port: String(port) }, ctx, tr);
  },
});

// 口の番号を先頭に足す形
export const portFirst = (words: string[], port: number): string[] => [String(port), ...words];

// router rip・router ospf <番号>・router bgp <AS> の結果に、router のモードへ入る指定を足す。
// config のモードでだけ入る（exec の古い形はモードを変えない）。設定の操作がない結果（誤り・読み取り専用の拒否）は、そのまま返す
export const enterRouter = (ctx: CommandContext, result: CommandResult, mode: Mode, process: number | null): CommandResult =>
  ctx.session.mode === 'config' && result.change !== null ? { ...result, session: { mode, iface: null, process } } : result;

// プロンプトの言語ファイルの鍵（<ホスト名>#・<ホスト名>(config)#・<ホスト名>(config-if)#・<ホスト名>(config-router)#）
export const promptKeyOf = (mode: Mode): string => {
  switch (mode) {
    case 'exec': return 'ui.terminal.prompt';
    case 'config': return 'ui.terminal.promptConfig';
    case 'interface': return 'ui.terminal.promptInterface';
    case 'router-rip':
    case 'router-ospf':
    case 'router-bgp': return 'ui.terminal.promptRouter';
  }
};
