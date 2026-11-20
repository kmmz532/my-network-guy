// DHCP の論点の命令。
import { dhcpOf } from '../../query/dhcp';
import { changed, nameOf, out, shown } from '../../command/lines';
import type { DhcpPool } from '../../dhcp';
import type { CommandContext, CommandResult, CommandSpec, Token } from '../../command/types';
import type { Tr } from '../../terminal';
import { interfaceOf } from '../../command/modes';
import { prefixOfMask } from '../../command/args';
import { getComponent } from '../../components';

const PORT = { arg: 'number', name: 'port' } as const;

// ip dhcp pool の形。任意の項目（gateway・dns）は、この順に、あるものだけを続ける
const poolChange = (args: Readonly<Record<string, string>>, ctx: CommandContext, tr: Tr): CommandResult => {
  const pool: DhcpPool = { network: args.network, prefix: prefixOfMask(args.mask), start: args.start, end: args.end };
  if (args.gateway !== undefined) pool.gateway = args.gateway;
  if (args.dns !== undefined) pool.dns = args.dns;
  return changed(ctx, tr, { kind: 'dhcp', change: { op: 'pool', pool } });
};
const poolTokens: readonly Token[] = [
  { word: 'ip' },
  { word: 'dhcp' },
  { word: 'pool' },
  { arg: 'ip', name: 'network' },
  { arg: 'mask', name: 'mask' },
  { arg: 'ip', name: 'start' },
  { arg: 'ip', name: 'end' },
];
const gateway: Token[] = [{ word: 'gateway' }, { arg: 'ip', name: 'gateway' }];
const dns: Token[] = [{ word: 'dns' }, { arg: 'ip', name: 'dns' }];

// ip helper-address <口> <IP>。interface モードの形は口の番号を外す
const ipHelperAddress: CommandSpec = {
    id: 'dhcp.ipHelperAddress',
    modes: ['exec', 'config'],
    tokens: [{ word: 'ip' }, { word: 'helper-address' }, PORT, { arg: 'ip', name: 'ip' }],
    help: 'ui.cmd.dhcp.ipHelperAddress',
    writes: true,
    topic: 'dhcp',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'dhcp', change: { op: 'helper', port: Number(args.port), ip: args.ip } }),
  };

export const commands: readonly CommandSpec[] = [
  {
    id: 'dhcp.showIpDhcpBinding',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'ip' }, { word: 'dhcp' }, { word: 'binding' }],
    help: 'ui.cmd.dhcp.showIpDhcpBinding',
    writes: false,
    topic: 'dhcp',
    run: (_args, ctx, tr) => {
      const { node } = ctx;
      // 配ったアドレス（このサーバーが配ったもの）。割り当ては毎回計算で求める
      const leases = dhcpOf(ctx.state).leases.filter((l) => l.server === node.uid);
      // 予約（N153）は、配ったかどうかに関わらず、登録の行を後ろに出す
      const reservations = (getComponent(node, 'dhcpServer') ?? []).flatMap((p) => p.reservations ?? []);
      const reserved = reservations.map((r) => out(tr('ui.terminal.dhcpReservation', { ip: r.ip, mac: r.mac })));
      if (leases.length === 0) return shown([out(tr('ui.terminal.dhcpNone')), ...reserved]);
      return shown([...leases.map((l) => out(tr('ui.terminal.dhcpBinding', { ip: l.ip, name: nameOf(ctx, ctx.nodes.find((n) => n.uid === l.uid) ?? node), port: l.port }))), ...reserved]);
    },
  },
  ipHelperAddress,
  interfaceOf(ipHelperAddress),
  {
    id: 'dhcp.noIpHelperAddress',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'helper-address' }, PORT],
    help: 'ui.cmd.dhcp.noIpHelperAddress',
    writes: true,
    topic: 'dhcp',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'dhcp', change: { op: 'helper', port: Number(args.port), ip: null } }),
  },
  {
    id: 'dhcp.ipDhcpPool',
    modes: ['exec', 'config'],
    tokens: poolTokens,
    help: 'ui.cmd.dhcp.ipDhcpPool',
    writes: true,
    topic: 'dhcp',
    run: poolChange,
  },
  {
    id: 'dhcp.ipDhcpPoolGateway',
    modes: ['exec', 'config'],
    tokens: [...poolTokens, ...gateway],
    help: 'ui.cmd.dhcp.ipDhcpPoolGateway',
    writes: true,
    topic: 'dhcp',
    run: poolChange,
  },
  {
    id: 'dhcp.ipDhcpPoolDns',
    modes: ['exec', 'config'],
    tokens: [...poolTokens, ...dns],
    help: 'ui.cmd.dhcp.ipDhcpPoolDns',
    writes: true,
    topic: 'dhcp',
    run: poolChange,
  },
  {
    id: 'dhcp.ipDhcpPoolGatewayDns',
    modes: ['exec', 'config'],
    tokens: [...poolTokens, ...gateway, ...dns],
    help: 'ui.cmd.dhcp.ipDhcpPoolGatewayDns',
    writes: true,
    topic: 'dhcp',
    run: poolChange,
  },
  {
    id: 'dhcp.noIpDhcpPool',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'dhcp' }, { word: 'pool' }, { arg: 'ip', name: 'network' }],
    help: 'ui.cmd.dhcp.noIpDhcpPool',
    writes: true,
    topic: 'dhcp',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'dhcp', change: { op: 'noPool', network: args.network } }),
  },
  // 予約（N153）: ip dhcp reservation <IP> <MAC>。アドレスを含むプールに登録する
  {
    id: 'dhcp.ipDhcpReservation',
    modes: ['exec', 'config'],
    tokens: [{ word: 'ip' }, { word: 'dhcp' }, { word: 'reservation' }, { arg: 'ip', name: 'ip' }, { arg: 'mac', name: 'mac' }],
    help: 'ui.cmd.dhcp.ipDhcpReservation',
    writes: true,
    topic: 'dhcp',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'dhcp', change: { op: 'reserve', ip: args.ip, mac: args.mac } }),
  },
  {
    id: 'dhcp.noIpDhcpReservation',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'dhcp' }, { word: 'reservation' }, { arg: 'ip', name: 'ip' }],
    help: 'ui.cmd.dhcp.noIpDhcpReservation',
    writes: true,
    topic: 'dhcp',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'dhcp', change: { op: 'unreserve', ip: args.ip } }),
  },
];
