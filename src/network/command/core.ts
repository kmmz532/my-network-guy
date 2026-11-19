// 論点のない命令: help・show ip・show ip interface brief・show interfaces・show running-config・show arp・ping・traceroute。
// 命令は CommandSpec 1つ。tokens が語の並び、run が実行で、出力の行を返す（設定は変えない）。
import { ping } from '../engine';
import { isL2Category, isRoutingCategory } from '../category';
import { framesOf } from '../frames';
import { macOf } from '../mac';
import { lagBundlesOf } from '../query/lagBundles';
import { portSpeedOf } from '../query/portSpeedOf';
import { resolveName } from '../resolve';
import { isIp, parseIfaceName, prefixOfMask } from './args';
import { SUB_MODES, sessionPortOf } from './modes';
import { questionLines, questionList } from './suggest';
import type { NetNode } from '../types';
import { getComponent } from '../components';
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

// 機器の口の番号（配線のある口と、機器のインターフェースの口。昇順）
const portsOf = (ctx: CommandContext, peers: Map<number, NetNode | undefined>): number[] =>
  [...new Set([...ctx.node.interfaces.map((i) => i.port), ...peers.keys()])].sort((a, b) => a - b);

// 速さの表記（Mbps の形。速さの定義がなければ auto）
const speedText = (mbps: number | undefined): string => (mbps === undefined ? 'auto' : `${mbps}Mb/s`);

// 束ねた口（Po）のうち、まとまっている物理の口の番号（show etherchannel summary と同じ読み方）
const bundledPortsOf = (ctx: CommandContext): Set<number> =>
  new Set(
    lagBundlesOf(ctx.state, ctx.node.uid)
      .flatMap((b) => b.links.flatMap((l) => [l.a, l.b]))
      .filter((e) => e.node === ctx.node.uid)
      .map((e) => e.port),
  );

// show ip interface brief の表。先頭の行は列見出し。行は、物理の口・SVI（Vlan）・Po（Port-channel）の順に、番号の順
// 情報源は show ip と同じ（機器のインターフェース）。状態は、物理の口が配線されていて停止していなければ up、SVI は停止の設定がないため up、Po はまとまった口があれば up
const briefTable = (ctx: CommandContext, tr: Tr): string[] => {
  const { node } = ctx;
  const linked = peersOf(ctx);
  const bundled = bundledPortsOf(ctx);
  const rows = node.interfaces.map((i) => {
    const up = i.kind === 'svi'
      ? true
      : i.kind === 'po'
        ? node.ports.some((p) => p.channelGroup === i.channel && bundled.has(p.port))
        : linked.has(i.port) && !ctx.state.links.isShut(node.uid, i.port);
    const name = i.kind === 'svi' ? tr('ui.terminal.briefVlan', { vlan: i.vlan as number }) : i.kind === 'po' ? tr('ui.terminal.briefPo', { channel: i.channel as number }) : i.id;
    const ip = i.ip !== '' ? i.ip : tr(i.dhcp === true ? 'ui.terminal.briefDhcp' : 'ui.terminal.briefUnassigned');
    const rank = i.kind === 'port' ? 0 : i.kind === 'svi' ? 1 : 2;
    const no = i.kind === 'svi' ? (i.vlan as number) : i.kind === 'po' ? (i.channel as number) : i.port;
    return { rank, no, cells: [name, ip, tr(up ? 'ui.terminal.briefUp' : 'ui.terminal.briefDown')] };
  });
  rows.sort((a, b) => a.rank - b.rank || a.no - b.no);
  const head = [tr('ui.terminal.briefInterface'), tr('ui.terminal.briefIp'), tr('ui.terminal.briefStatus')];
  const table = [head, ...rows.map((r) => r.cells)];
  const widths = head.map((_, c) => Math.max(...table.map((r) => r[c].length)));
  return table.map((r) => r.map((cell, c) => cell.padEnd(widths[c])).join('  ').trimEnd());
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
  help: 'ui.cmd.core.ipAddress',
  writes: true,
  topic: null,
  run: (args, ctx, tr) => changed(ctx, tr, { kind: 'iface', port: Number(args.port), ip: args.ip, prefix: prefixOfMask(args.mask) }),
};
const ipAddressDhcp: CommandSpec = {
  id: 'core.ipAddressDhcp',
  modes: ['exec', 'config'],
  tokens: [{ word: 'ip' }, { word: 'address' }, PORT, { word: 'dhcp' }],
  help: 'ui.cmd.core.ipAddressDhcp',
  writes: true,
  topic: null,
  run: (args, ctx, tr) => changed(ctx, tr, { kind: 'dhcp', change: { op: 'client', port: Number(args.port) } }),
};

// interface モードの ip address。口は ip address <IP> <マスク>・ip address dhcp、SVI は ip address <IP> <マスク>（口の番号は書かない）
const ipAddressInterface: CommandSpec = {
  id: 'core.ipAddressInterface',
  modes: ['interface'],
  tokens: [{ word: 'ip' }, { word: 'address' }, { arg: 'ip', name: 'ip' }, { arg: 'mask', name: 'mask' }],
  help: 'ui.cmd.core.ipAddressInterface',
  writes: true,
  topic: null,
  run: (args, ctx, tr) => {
    const { iface } = ctx.session;
    if (iface?.kind === 'svi') return changed(ctx, tr, { kind: 'svi', vlan: iface.vlan, ip: args.ip, prefix: prefixOfMask(args.mask) });
    if (iface?.kind === 'po') return changed(ctx, tr, { kind: 'po', channel: iface.channel, ip: args.ip, prefix: prefixOfMask(args.mask) });
    return changed(ctx, tr, { kind: 'iface', port: sessionPortOf(ctx) as number, ip: args.ip, prefix: prefixOfMask(args.mask) });
  },
};
const ipAddressInterfaceDhcp: CommandSpec = {
  id: 'core.ipAddressInterfaceDhcp',
  modes: ['interface'],
  tokens: [{ word: 'ip' }, { word: 'address' }, { word: 'dhcp' }],
  help: 'ui.cmd.core.ipAddressInterfaceDhcp',
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
    help: 'ui.cmd.core.configureTerminal',
    writes: false,
    topic: null,
    run: () => enter({ mode: 'config', iface: null, process: null }),
  },
  {
    id: 'core.interface',
    modes: ['config'],
    tokens: [{ word: 'interface' }, { arg: 'iface', name: 'name' }],
    help: 'ui.cmd.core.interface',
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
    help: 'ui.cmd.core.exit',
    writes: false,
    topic: null,
    // 1つ上へ。config からは exec へ、interface・router からは config へ
    run: (_args, ctx) => enter({ mode: ctx.session.mode === 'config' ? 'exec' : 'config', iface: null, process: null }),
  },
  {
    id: 'core.end',
    modes: ['config', ...SUB_MODES],
    tokens: [{ word: 'end' }],
    help: 'ui.cmd.core.end',
    writes: false,
    topic: null,
    run: () => enter({ mode: 'exec', iface: null, process: null }),
  },
  {
    id: 'core.hostname',
    modes: ['exec', 'config'],
    tokens: [{ word: 'hostname' }, { arg: 'hostname', name: 'name' }],
    help: 'ui.cmd.core.hostname',
    writes: true,
    topic: null,
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'hostname', hostname: args.name }),
  },
  {
    id: 'core.noHostname',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'hostname' }],
    help: 'ui.cmd.core.noHostname',
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
    help: 'ui.cmd.core.noIpAddressInterface',
    writes: true,
    topic: null,
    run: (_args, ctx, tr) => {
      const { iface } = ctx.session;
      if (iface?.kind === 'svi') return changed(ctx, tr, { kind: 'svi', vlan: iface.vlan, ip: '', prefix: 24 });
      if (iface?.kind === 'po') return changed(ctx, tr, { kind: 'po', channel: iface.channel, ip: '', prefix: 24 });
      return changed(ctx, tr, { kind: 'iface', port: sessionPortOf(ctx) as number, ip: '', prefix: 24 });
    },
  },
  {
    id: 'core.help',
    modes: ['exec', 'config', ...SUB_MODES],
    tokens: [{ word: 'help' }],
    help: 'ui.cmd.core.help',
    writes: false,
    topic: null,
    run: (_args, ctx, tr) => shown(questionLines(questionList('', ctx), tr).map(out)),
  },
  {
    id: 'core.showIp',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'ip' }],
    help: 'ui.cmd.core.showIp',
    writes: false,
    topic: null,
    run: (_args, { node }, tr) => {
      if (node.interfaces.length === 0) return shown([out(tr('ui.terminal.noIp'))]);
      const lines = node.interfaces.map((i) => out(i.kind === 'po'
        ? tr('ui.terminal.poLine', { channel: i.channel ?? 0, ip: i.ip, prefix: i.prefix })
        : tr('ui.terminal.ifLine', { port: i.port, ip: i.ip, prefix: i.prefix })));
      if (node.gateway) lines.push(out(tr('ui.terminal.gateway', { gateway: node.gateway })));
      return shown(lines);
    },
  },
  {
    id: 'core.showIpInterfaceBrief',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'ip' }, { word: 'interface' }, { word: 'brief' }],
    help: 'ui.cmd.core.showIpInterfaceBrief',
    writes: false,
    topic: null,
    run: (_args, ctx, tr) => {
      if (ctx.node.interfaces.length === 0) return shown([out(tr('ui.terminal.noIp'))]);
      return shown(briefTable(ctx, tr).map(out));
    },
  },
  {
    id: 'core.showInterfaces',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'interfaces' }],
    help: 'ui.cmd.core.showInterfaces',
    writes: false,
    topic: null,
    run: (_args, ctx, tr) => {
      const { node } = ctx;
      const peers = peersOf(ctx);
      const ports = portsOf(ctx, peers);
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
          const speed = portSpeedOf(ctx.state, ctx.links, node.uid, node.device, port);
          return [line, out(tr('ui.terminal.mac', { port, mac: macOfPort(ctx, port) })), out(tr('ui.terminal.ifSpeed', { port, speed: speedText(speed) }))];
        }),
      );
    },
  },
  {
    id: 'core.showInterfacesStatus',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'interfaces' }, { word: 'status' }],
    help: 'ui.cmd.core.showInterfacesStatus',
    writes: false,
    topic: null,
    run: (_args, ctx, tr) => {
      const { node } = ctx;
      const peers = peersOf(ctx);
      const ports = portsOf(ctx, peers);
      if (ports.length === 0) return shown([out(tr('ui.terminal.noPort'))]);
      // 速さは、つながった口は a-<速さ>（自動の交渉の結果）、つながっていない口は auto
      const table: string[][] = [
        [tr('ui.terminal.statusPort'), tr('ui.terminal.statusState'), tr('ui.terminal.statusSpeed')],
        ...ports.map((port) => {
          const linked = peers.has(port);
          const speed = linked ? portSpeedOf(ctx.state, ctx.links, node.uid, node.device, port) : undefined;
          return [String(port), tr(linked ? 'ui.terminal.statusConnected' : 'ui.terminal.statusNotconnect'), speed === undefined ? 'auto' : `a-${speed}`];
        }),
      ];
      const widths = table[0].map((_, c) => Math.max(...table.map((r) => r[c].length)));
      return shown(table.map((r) => out(r.map((cell, c) => cell.padEnd(widths[c])).join('  ').trimEnd())));
    },
  },
  {
    id: 'core.showArp',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'arp' }],
    help: 'ui.cmd.core.showArp',
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
    help: 'ui.cmd.core.showRunningConfig',
    writes: false,
    topic: null,
    run: (_args, { node }, tr) => {
      const lines: TerminalLine[] = node.hostname ? [out(tr('ui.terminal.cfgHostname', { name: node.hostname }))] : [];
      // SVI は口を持たないため、口の番号（仮想の番号）ではなく VLAN の番号で出す
      for (const i of node.interfaces) {
        if (i.kind === 'svi') lines.push(out(tr('ui.terminal.cfgVlanInterface', { vlan: i.vlan as number })));
        else lines.push(out(i.kind === 'po' ? tr('ui.terminal.cfgPoInterface', { channel: i.channel ?? 0 }) : tr('ui.terminal.cfgInterface', { port: i.port })));
      }
      for (const h of getComponent(node, 'resolver')?.hosts ?? []) lines.push(out(tr('ui.terminal.cfgHost', { name: h.name, ip: h.ip })));
      const nameServer = getComponent(node, 'resolver')?.nameServer;
      if (nameServer) lines.push(out(tr('ui.terminal.cfgNameServer', { ip: nameServer })));
      for (const i of node.interfaces) lines.push(out(tr('ui.terminal.cfgAddress', { ip: i.ip, prefix: i.prefix })));
      if (node.gateway) lines.push(out(tr('ui.terminal.cfgGateway', { gateway: node.gateway })));
      // 無線（SSID・チャネル・VLAN。パスワードは出さない）と RIP の参加を、設定として出す（N151・N141b）
      const wifi = getComponent(node, 'wireless');
      if (wifi?.ssid !== undefined) lines.push(out(tr('ui.terminal.cfgWireless', { ssid: wifi.ssid })));
      if (node.interfaces.some((i) => i.rip === true)) lines.push(out(tr('ui.terminal.cfgRip')));
      const ospfProcess = getComponent(node, 'ospf')?.process;
      if (ospfProcess !== undefined) lines.push(out(tr('ui.terminal.cfgOspf', { process: ospfProcess })));
      for (const r of node.routes) lines.push(out(tr('ui.terminal.cfgRoute', { dest: r.dest, prefix: r.prefix, nextHop: r.nextHop })));
      return shown(lines.length > 0 ? lines : [out(tr('ui.terminal.cfgEmpty'))]);
    },
  },
  {
    id: 'core.ping',
    modes: ['exec'],
    tokens: [{ word: 'ping' }, { arg: 'hostOrIp', name: 'target' }],
    help: 'ui.cmd.core.ping',
    writes: false,
    topic: null,
    run: (args, ctx, tr) => shown(probe('ping', args.target, ctx, tr)),
  },
  {
    id: 'core.traceroute',
    modes: ['exec'],
    tokens: [{ word: 'traceroute' }, { arg: 'hostOrIp', name: 'target' }],
    help: 'ui.cmd.core.traceroute',
    writes: false,
    topic: null,
    run: (args, ctx, tr) => shown(probe('traceroute', args.target, ctx, tr)),
  },
];
