// 論点のない命令: help・show ip・show interfaces・show running-config・show arp・ping・traceroute。
// 命令は CommandSpec 1つ。tokens が語の並び、run が実行で、出力の行を返す（設定は変えない）。
import { ping } from '../engine';
import { isL2Category, isRoutingCategory } from '../category';
import { framesOf } from '../frames';
import { macOf } from '../mac';
import { resolveName } from '../resolve';
import { isIp, parseIfaceName, prefixOfMask } from './args';
import { SUB_MODES, sessionPortOf } from './modes';
import type { NetNode } from '../types';
import { deviceCategory } from '../../registry/query';
import type { TerminalLine, Tr } from '../terminal';
import { changed, err, nameOf, out, shown } from './lines';
import type { CommandContext, CommandResult, CommandSpec, TerminalSession } from './types';

// 機器の、ポートごとの接続先（ポート番号 → 相手の機器）
const peersOf = (ctx: CommandContext): Map<number, NetNode | undefined> => {
  const peers = new Map<number, NetNode | undefined>();
  for (const link of ctx.links) {
    if (link.a.node === ctx.node.uid) peers.set(link.a.port, ctx.nodes.find((n) => n.uid === link.b.node));
    if (link.b.node === ctx.node.uid) peers.set(link.b.port, ctx.nodes.find((n) => n.uid === link.a.node));
  }
  return peers;
};

// 機器のポートの MAC アドレス（機器の連番が必要）。連番のない機器は例外にする
const macOfPort = (ctx: CommandContext, port: number): string => {
  if (ctx.node.macSerial === undefined) throw new Error(`MAC アドレスの連番がない機器: ${ctx.node.uid}`);
  return macOf(deviceCategory(ctx.node.device), ctx.node.macSerial, port);
};

// ping と traceroute の共通の処理。宛先は IPアドレスか、名前（対応表 → ネームサーバーの順に引く）。名前は1行目に「名前 [IPアドレス]」を出す
const probe = (command: 'ping' | 'traceroute', given: string, ctx: CommandContext, tr: Tr): TerminalLine[] => {
  const { node } = ctx;
  let ip = given;
  let header: TerminalLine[] = [];
  if (!isIp(given)) {
    const r = resolveName(node, given, { nodes: ctx.nodes, links: ctx.links }, ctx.data);
    if (!r.ok) return [err(tr('ui.terminal.noResolve', { name: given }))];
    ip = r.ip;
    header = [out(tr('ui.terminal.resolved', { name: given, ip }))];
  }
  const target = ctx.nodes.find((n) => n.interfaces.some((i) => i.ip === ip));
  if (!target) return [err(tr('ui.terminal.noHost', { ip: given }))];
  const result = ping(ctx.state, node.uid, target.uid);
  ctx.onTrace?.({ kind: 'ping', src: node.uid, dst: target.uid, result });
  if (result.ok) ctx.onReach?.(target.uid);
  if (command === 'ping') {
    if (result.ok) return [...header, out(tr('ui.terminal.pingOk', { ip: given }))];
    const reason = result.failure?.reason ?? 'route.none';
    return [...header, err(tr('ui.terminal.pingNg')), err(tr(`error.${reason}`))];
  }
  // traceroute: 通った機器を1台ずつ、送信元の次から出す。届かなければ止まった場所と理由を出す
  // 各機器のアドレスは、そこへ届いたフレームを受けた口のアドレス（実機と同じく、受け取った口を出す）
  const categoryOfUid = (uid: string): string => {
    const device = ctx.nodes.find((n) => n.uid === uid)?.device ?? '';
    return deviceCategory(device);
  };
  const frameCtx = {
    nodes: ctx.nodes,
    links: ctx.links,
    categoryOf: deviceCategory,
    isSwitch: (uid: string) => isL2Category(categoryOfUid(uid)),
    isRouter: (uid: string) => isRoutingCategory(categoryOfUid(uid)),
  };
  const frames = framesOf(frameCtx, { ok: true, path: result.path });
  const hops = result.path.slice(1).map((uid, i) => {
    const hop = ctx.nodes.find((n) => n.uid === uid);
    const arrival = frames.find((f) => f.to === uid);
    const arrivalLink = arrival ? ctx.links.find((l) => l.uid === arrival.link) : undefined;
    const port = arrivalLink ? (arrivalLink.a.node === uid ? arrivalLink.a.port : arrivalLink.b.port) : undefined;
    const hopIp = hop?.interfaces.find((iface) => iface.port === port)?.ip ?? '-';
    return out(tr('ui.terminal.hop', { n: i + 1, ip: hopIp, name: hop ? nameOf(ctx, hop) : uid }));
  });
  if (result.ok) return [...header, ...hops];
  const reason = result.failure?.reason ?? 'route.none';
  return [...header, ...hops, err(tr('ui.terminal.traceNg')), err(tr(`error.${reason}`))];
};

// モードを変える結果。設定の操作は伴わない
const enter = (session: TerminalSession): CommandResult => ({ lines: [], change: null, session });

const PORT = { arg: 'number', name: 'port' } as const;

// ip address <口> <IP> <マスク>・ip address <口> dhcp（exec・config）。口の番号を行に書く形
const ipAddressPort: CommandSpec = {
  id: 'core.ipAddress',
  modes: ['exec', 'config'],
  tokens: [{ word: 'ip' }, { word: 'address' }, PORT, { arg: 'ip', name: 'ip' }, { arg: 'mask', name: 'mask' }],
  help: '',
  writes: true,
  topic: null,
  run: (args, ctx, tr) => changed(ctx, tr, { kind: 'iface', port: Number(args.port), ip: args.ip, prefix: prefixOfMask(args.mask) }),
};
const ipAddressDhcp: CommandSpec = {
  id: 'core.ipAddressDhcp',
  modes: ['exec', 'config'],
  tokens: [{ word: 'ip' }, { word: 'address' }, PORT, { word: 'dhcp' }],
  help: '',
  writes: true,
  topic: null,
  run: (args, ctx, tr) => changed(ctx, tr, { kind: 'dhcp', change: { op: 'client', port: Number(args.port) } }),
};

// interface モードの ip address。口は ip address <IP> <マスク>・ip address dhcp、SVI は ip address <IP> <マスク>（口の番号は書かない）
const ipAddressInterface: CommandSpec = {
  id: 'core.ipAddressInterface',
  modes: ['interface'],
  tokens: [{ word: 'ip' }, { word: 'address' }, { arg: 'ip', name: 'ip' }, { arg: 'mask', name: 'mask' }],
  help: '',
  writes: true,
  topic: null,
  run: (args, ctx, tr) => {
    const { iface } = ctx.session;
    if (iface?.kind === 'svi') return changed(ctx, tr, { kind: 'svi', vlan: iface.vlan, ip: args.ip, prefix: prefixOfMask(args.mask) });
    return changed(ctx, tr, { kind: 'iface', port: sessionPortOf(ctx) as number, ip: args.ip, prefix: prefixOfMask(args.mask) });
  },
};
const ipAddressInterfaceDhcp: CommandSpec = {
  id: 'core.ipAddressInterfaceDhcp',
  modes: ['interface'],
  tokens: [{ word: 'ip' }, { word: 'address' }, { word: 'dhcp' }],
  help: '',
  writes: true,
  topic: null,
  run: (_args, ctx, tr) => {
    const port = sessionPortOf(ctx);
    if (port === null) return shown([err(tr('ui.terminal.errIfaceKind'))]);
    return changed(ctx, tr, { kind: 'dhcp', change: { op: 'client', port } });
  },
};

export const commands: readonly CommandSpec[] = [
  {
    id: 'core.configureTerminal',
    modes: ['exec'],
    tokens: [{ word: 'configure' }, { word: 'terminal' }],
    help: '',
    writes: false,
    topic: null,
    run: () => enter({ mode: 'config', iface: null, process: null }),
  },
  {
    id: 'core.interface',
    modes: ['config'],
    tokens: [{ word: 'interface' }, { arg: 'iface', name: 'name' }],
    help: '',
    writes: false,
    topic: null,
    run: (args, ctx, tr) => {
      const iface = parseIfaceName(ctx.node.device, args.name);
      if (iface === null) return shown([err(tr('ui.terminal.errInterface'))]);
      return enter({ mode: 'interface', iface, process: null });
    },
  },
  {
    id: 'core.exit',
    modes: ['config', ...SUB_MODES],
    tokens: [{ word: 'exit' }],
    help: '',
    writes: false,
    topic: null,
    // 1つ上へ。config からは exec へ、interface・router からは config へ
    run: (_args, ctx) => enter({ mode: ctx.session.mode === 'config' ? 'exec' : 'config', iface: null, process: null }),
  },
  {
    id: 'core.end',
    modes: ['config', ...SUB_MODES],
    tokens: [{ word: 'end' }],
    help: '',
    writes: false,
    topic: null,
    run: () => enter({ mode: 'exec', iface: null, process: null }),
  },
  {
    id: 'core.hostname',
    modes: ['exec', 'config'],
    tokens: [{ word: 'hostname' }, { arg: 'hostname', name: 'name' }],
    help: '',
    writes: true,
    topic: null,
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'hostname', hostname: args.name }),
  },
  {
    id: 'core.noHostname',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'hostname' }],
    help: '',
    writes: true,
    topic: null,
    run: (_args, ctx, tr) => changed(ctx, tr, { kind: 'hostname', hostname: null }),
  },
  ipAddressPort,
  ipAddressDhcp,
  ipAddressInterface,
  ipAddressInterfaceDhcp,
  {
    id: 'core.noIpAddressInterface',
    modes: ['interface'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'address' }],
    help: '',
    writes: true,
    topic: null,
    run: (_args, ctx, tr) => {
      const { iface } = ctx.session;
      if (iface?.kind === 'svi') return changed(ctx, tr, { kind: 'svi', vlan: iface.vlan, ip: '', prefix: 24 });
      return changed(ctx, tr, { kind: 'iface', port: sessionPortOf(ctx) as number, ip: '', prefix: 24 });
    },
  },
  {
    id: 'core.help',
    modes: ['exec', 'config', ...SUB_MODES],
    tokens: [{ word: 'help' }],
    help: '',
    writes: false,
    topic: null,
    run: (_args, _ctx, tr) => shown([out(tr('ui.terminal.help'))]),
  },
  {
    id: 'core.showIp',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'ip' }],
    help: '',
    writes: false,
    topic: null,
    run: (_args, { node }, tr) => {
      if (node.interfaces.length === 0) return shown([out(tr('ui.terminal.noIp'))]);
      const lines = node.interfaces.map((i) => out(tr('ui.terminal.ifLine', { port: i.port, ip: i.ip, prefix: i.prefix })));
      if (node.gateway) lines.push(out(tr('ui.terminal.gateway', { gateway: node.gateway })));
      return shown(lines);
    },
  },
  {
    id: 'core.showInterfaces',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'interfaces' }],
    help: '',
    writes: false,
    topic: null,
    run: (_args, ctx, tr) => {
      const { node } = ctx;
      const peers = peersOf(ctx);
      const ports = [...new Set([...node.interfaces.map((i) => i.port), ...peers.keys()])].sort((a, b) => a - b);
      if (ports.length === 0) return shown([out(tr('ui.terminal.noPort'))]);
      return shown(
        ports.flatMap((port) => {
          const iface = node.interfaces.find((i) => i.port === port);
          const peer = peers.get(port);
          const line = !peer
            ? out(tr('ui.terminal.ifFree', { port }))
            : iface
              ? out(tr('ui.terminal.ifLinkedIp', { port, ip: iface.ip, prefix: iface.prefix, peer: nameOf(ctx, peer) }))
              : out(tr('ui.terminal.ifLinked', { port, peer: nameOf(ctx, peer) }));
          return [line, out(tr('ui.terminal.mac', { port, mac: macOfPort(ctx, port) }))];
        }),
      );
    },
  },
  {
    id: 'core.showArp',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'arp' }],
    help: '',
    writes: false,
    topic: null,
    run: (_args, ctx, tr) => {
      const rows = ctx.arp ?? [];
      return shown(rows.length > 0 ? rows.map((r) => out(tr('ui.terminal.arpLine', { ip: r.ip, mac: r.mac }))) : [out(tr('ui.terminal.noArp'))]);
    },
  },
  {
    id: 'core.showRunningConfig',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'running-config' }],
    help: '',
    writes: false,
    topic: null,
    run: (_args, { node }, tr) => {
      const lines: TerminalLine[] = node.hostname ? [out(tr('ui.terminal.cfgHostname', { name: node.hostname }))] : [];
      for (const i of node.interfaces) lines.push(out(tr('ui.terminal.cfgInterface', { port: i.port })));
      for (const h of node.hosts ?? []) lines.push(out(tr('ui.terminal.cfgHost', { name: h.name, ip: h.ip })));
      if (node.nameServer) lines.push(out(tr('ui.terminal.cfgNameServer', { ip: node.nameServer })));
      for (const i of node.interfaces) lines.push(out(tr('ui.terminal.cfgAddress', { ip: i.ip, prefix: i.prefix })));
      if (node.gateway) lines.push(out(tr('ui.terminal.cfgGateway', { gateway: node.gateway })));
      // 無線（SSID・チャネル・VLAN。パスワードは出さない）と RIP の参加を、設定として出す（N151・N141b）
      if (node.wireless?.ssid !== undefined) lines.push(out(tr('ui.terminal.cfgWireless', { ssid: node.wireless.ssid })));
      if (node.interfaces.some((i) => i.rip === true)) lines.push(out(tr('ui.terminal.cfgRip')));
      if (node.ospf?.process !== undefined) lines.push(out(tr('ui.terminal.cfgOspf', { process: node.ospf.process })));
      for (const r of node.routes) lines.push(out(tr('ui.terminal.cfgRoute', { dest: r.dest, prefix: r.prefix, nextHop: r.nextHop })));
      return shown(lines.length > 0 ? lines : [out(tr('ui.terminal.cfgEmpty'))]);
    },
  },
  {
    id: 'core.ping',
    modes: ['exec'],
    tokens: [{ word: 'ping' }, { arg: 'hostOrIp', name: 'target' }],
    help: '',
    writes: false,
    topic: null,
    run: (args, ctx, tr) => shown(probe('ping', args.target, ctx, tr)),
  },
  {
    id: 'core.traceroute',
    modes: ['exec'],
    tokens: [{ word: 'traceroute' }, { arg: 'hostOrIp', name: 'target' }],
    help: '',
    writes: false,
    topic: null,
    run: (args, ctx, tr) => shown(probe('traceroute', args.target, ctx, tr)),
  },
];
