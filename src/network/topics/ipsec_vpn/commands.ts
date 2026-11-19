// IPsec VPN の論点の命令。トンネルの一覧（機器の部品 vpn）を、命令ごとに直して置き換える。
// crypto map のエントリは、名前と番号で探す。命令の途中の状態（相手・鍵・LAN がまだない）は、未設定の値（0.0.0.0・空の鍵・0.0.0.0/0）で持つ。
// そのトンネルは相手に届かない扱いになり、張れない理由として示す。
import { prefixOfMask } from '../../command/args';
import { changed, err, out, shown } from '../../command/lines';
import type { CommandContext, CommandResult, CommandSpec, TerminalSession } from '../../command/types';
import { getComponent, type Components } from '../../components';
import type { Tr } from '../../terminal';

type Tunnels = NonNullable<Components['vpn']>;
type Tunnel = Tunnels[number];

const NEW_TUNNEL = { peer: '0.0.0.0', psk: '', cipher: 'aes', local: '0.0.0.0/0', remote: '0.0.0.0/0' } as const;
const CIPHERS: readonly string[] = ['aes', '3des'];

const tunnelsOf = (ctx: CommandContext): Tunnels => getComponent(ctx.node, 'vpn') ?? [];

// crypto-map モードの対象のエントリ（名前と番号が一致するもの）の位置。対象がない（config のモードや、消えたあと）は -1
const entryIndex = (tunnels: Tunnels, session: TerminalSession): number => {
  if (session.map === undefined || session.process === null) return -1;
  const { map, process: seq } = session;
  return tunnels.findIndex((t) => t.map === map && t.seq === seq);
};

// crypto-map モードの命令の共通の形。対象のエントリを edit で直し、エントリがなければ誤りを返す
const editEntry = (ctx: CommandContext, tr: Tr, edit: (t: Tunnel) => Tunnel): CommandResult => {
  const tunnels = tunnelsOf(ctx);
  const at = entryIndex(tunnels, ctx.session);
  if (at < 0) return shown([err(tr('ui.terminal.vpnNoMap'))]);
  return changed(ctx, tr, { kind: 'vpn', tunnels: tunnels.map((t, i) => (i === at ? edit(t) : t)) });
};

export const commands: readonly CommandSpec[] = [
  {
    id: 'ipsec_vpn.cryptoIsakmpKey',
    modes: ['exec', 'config'],
    tokens: [{ word: 'crypto' }, { word: 'isakmp' }, { word: 'key' }, { arg: 'psk', name: 'key' }, { word: 'address' }, { arg: 'ip', name: 'peer' }],
    help: 'ui.cmd.ipsec_vpn.cryptoIsakmpKey',
    writes: true,
    topic: 'ipsec_vpn',
    run: (args, ctx, tr) => {
      const tunnels = tunnelsOf(ctx);
      // 鍵は、その相手（set peer で決めたエントリ）に入れる。相手のエントリがなければ誤り
      if (!tunnels.some((t) => t.peer === args.peer)) return shown([err(tr('ui.terminal.vpnNoPeer'))]);
      return changed(ctx, tr, { kind: 'vpn', tunnels: tunnels.map((t) => (t.peer === args.peer ? { ...t, psk: args.key } : t)) });
    },
  },
  {
    id: 'ipsec_vpn.noCryptoIsakmpKey',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'crypto' }, { word: 'isakmp' }, { word: 'key' }, { word: 'address' }, { arg: 'ip', name: 'peer' }],
    help: 'ui.cmd.ipsec_vpn.noCryptoIsakmpKey',
    writes: true,
    topic: 'ipsec_vpn',
    run: (args, ctx, tr) => {
      const tunnels = tunnelsOf(ctx);
      if (!tunnels.some((t) => t.peer === args.peer)) return shown([err(tr('ui.terminal.vpnNoPeer'))]);
      return changed(ctx, tr, { kind: 'vpn', tunnels: tunnels.map((t) => (t.peer === args.peer ? { ...t, psk: '' } : t)) });
    },
  },
  {
    id: 'ipsec_vpn.cryptoMap',
    modes: ['exec', 'config'],
    tokens: [{ word: 'crypto' }, { word: 'map' }, { arg: 'word', name: 'name' }, { arg: 'number', name: 'seq' }, { word: 'ipsec-isakmp' }],
    help: 'ui.cmd.ipsec_vpn.cryptoMap',
    writes: true,
    topic: 'ipsec_vpn',
    run: (args, ctx, tr) => {
      const tunnels = tunnelsOf(ctx);
      const seq = Number(args.seq);
      // エントリのモードへは、config から入るときだけ入る（exec の形はモードを変えない）
      const session: TerminalSession | null = ctx.session.mode === 'config' ? { mode: 'crypto-map', iface: null, process: seq, map: args.name } : null;
      // 同じ名前と番号のエントリがあれば、作らずにそのエントリのモードへ入る
      if (tunnels.some((t) => t.map === args.name && t.seq === seq)) return { lines: [], change: null, session };
      const change = changed(ctx, tr, { kind: 'vpn', tunnels: [...tunnels, { ...NEW_TUNNEL, map: args.name, seq }] });
      return ctx.readOnly ? change : { ...change, session };
    },
  },
  {
    id: 'ipsec_vpn.noCryptoMap',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'crypto' }, { word: 'map' }, { arg: 'word', name: 'name' }, { arg: 'number', name: 'seq' }],
    help: 'ui.cmd.ipsec_vpn.noCryptoMap',
    writes: true,
    topic: 'ipsec_vpn',
    run: (args, ctx, tr) => {
      const tunnels = tunnelsOf(ctx);
      const seq = Number(args.seq);
      if (!tunnels.some((t) => t.map === args.name && t.seq === seq)) return shown([err(tr('ui.terminal.vpnNoMap'))]);
      return changed(ctx, tr, { kind: 'vpn', tunnels: tunnels.filter((t) => !(t.map === args.name && t.seq === seq)) });
    },
  },
  {
    id: 'ipsec_vpn.setPeer',
    modes: ['crypto-map'],
    tokens: [{ word: 'set' }, { word: 'peer' }, { arg: 'ip', name: 'peer' }],
    help: 'ui.cmd.ipsec_vpn.setPeer',
    writes: true,
    topic: 'ipsec_vpn',
    run: (args, ctx, tr) => editEntry(ctx, tr, (t) => ({ ...t, peer: args.peer })),
  },
  {
    id: 'ipsec_vpn.setTransformSet',
    modes: ['crypto-map'],
    tokens: [{ word: 'set' }, { word: 'transform-set' }, { arg: 'word', name: 'cipher' }],
    help: 'ui.cmd.ipsec_vpn.setTransformSet',
    writes: true,
    topic: 'ipsec_vpn',
    run: (args, ctx, tr) => {
      if (!CIPHERS.includes(args.cipher)) return shown([err(tr('ui.terminal.vpnCipher'))]);
      const cipher = args.cipher as Tunnel['cipher'];
      return editEntry(ctx, tr, (t) => ({ ...t, cipher }));
    },
  },
  {
    id: 'ipsec_vpn.matchAddress',
    modes: ['crypto-map'],
    tokens: [
      { word: 'match' },
      { word: 'address' },
      { arg: 'ip', name: 'local' },
      { arg: 'mask', name: 'localMask' },
      { arg: 'ip', name: 'remote' },
      { arg: 'mask', name: 'remoteMask' },
    ],
    help: 'ui.cmd.ipsec_vpn.matchAddress',
    writes: true,
    topic: 'ipsec_vpn',
    run: (args, ctx, tr) =>
      editEntry(ctx, tr, (t) => ({
        ...t,
        local: `${args.local}/${prefixOfMask(args.localMask)}`,
        remote: `${args.remote}/${prefixOfMask(args.remoteMask)}`,
      })),
  },
  {
    id: 'ipsec_vpn.showCryptoSession',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'crypto' }, { word: 'session' }],
    help: 'ui.cmd.ipsec_vpn.showCryptoSession',
    writes: false,
    topic: 'ipsec_vpn',
    run: (_args, ctx, tr) => {
      const mine = ctx.state.vpn.tunnels.filter((s) => s.router === ctx.node.uid);
      if (mine.length === 0) return shown([out(tr('ui.terminal.vpnNone'))]);
      return shown(
        mine.map((s) =>
          s.ok
            ? out(tr('ui.terminal.vpnUp', { peer: s.tunnel.peer }))
            : out(tr('ui.terminal.vpnDown', { peer: s.tunnel.peer, reason: tr(`error.${s.reason}`) })),
        ),
      );
    },
  },
];
