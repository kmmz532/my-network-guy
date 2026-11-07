// 機器のターミナルのコマンド。入力の行を受け取り、出力の行を返す（画面には出さない純粋な関数）。
// 確認のコマンド: help・show ip・show ip route・show interfaces・show running-config・ping・traceroute。
// 補完（Tab）と、clear・hostname は、それぞれ別の関数で扱う（ここでは help の文言だけ）。
// 文言は tr（言語ファイルの引き当て）で作る。モードは持たない。
import { ping } from './engine';
import { networkAddress } from './segments';
import { isIp } from './terminalConfig';
import { resolveName } from './resolve';
import { macOf, type MacEntry } from './mac';
import type { EngineData, NetLink, NetNode } from './types';
import { learnedRoutesOf, macTableOf, ospfNeighborsOf } from './netState';

export interface TerminalContext {
  node: NetNode;
  nodes: NetNode[];
  links: NetLink[];
  data: EngineData;
  // 機器の画面に出す名前（省略時は uid）
  nameOf?: (node: NetNode) => string;
  // ARP の表（ping で覚えたもの。保存しない）（N69）
  arp?: { ip: string; mac: string }[];
  // L2スイッチの MAC の表（通信で覚えたもの。保存しない）（N69）
  macTable?: MacEntry[];
  // 通信が届いたときに呼ぶ（宛先の機器の uid）。画面が ARP と MAC の表を覚えるために使う（N69）
  onReach?: (dstUid: string) => void;
}

export type Tr = (key: string, params?: Record<string, string | number>) => string;

export interface TerminalLine {
  text: string;
  // err は失敗の行（画面で色を変える）
  kind: 'out' | 'err';
}

// 機器の、ポートごとの接続先（ポート番号 → 相手の機器）
const peersOf = (ctx: TerminalContext): Map<number, NetNode | undefined> => {
  const peers = new Map<number, NetNode | undefined>();
  for (const link of ctx.links) {
    if (link.a.node === ctx.node.uid) peers.set(link.a.port, ctx.nodes.find((n) => n.uid === link.b.node));
    if (link.b.node === ctx.node.uid) peers.set(link.b.port, ctx.nodes.find((n) => n.uid === link.a.node));
  }
  return peers;
};

// 機器のポートの MAC アドレス（機器の連番が必要）。連番のない機器は例外にする
const macOfPort = (ctx: TerminalContext, port: number): string => {
  if (ctx.node.macSerial === undefined) throw new Error(`MAC アドレスの連番がない機器: ${ctx.node.uid}`);
  return macOf(ctx.data.categoryOf(ctx.node.device), ctx.node.macSerial, port);
};

export const runTerminal = (line: string, ctx: TerminalContext, tr: Tr): TerminalLine[] => {
  const words = line.trim().split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return [];
  const out = (text: string): TerminalLine => ({ text, kind: 'out' });
  const err = (text: string): TerminalLine => ({ text, kind: 'err' });
  const name = (n: NetNode) => (ctx.nameOf ? ctx.nameOf(n) : n.uid);
  const [cmd, ...args] = words;
  const { node } = ctx;

  if (cmd === 'help') return [out(tr('ui.terminal.help'))];

  if (cmd === 'show') {
    const sub = args.join(' ');
    if (sub === 'ip') {
      if (node.interfaces.length === 0) return [out(tr('ui.terminal.noIp'))];
      const lines = node.interfaces.map((i) => out(tr('ui.terminal.ifLine', { port: i.port, ip: i.ip, prefix: i.prefix })));
      if (node.gateway) lines.push(out(tr('ui.terminal.gateway', { gateway: node.gateway })));
      return lines;
    }
    if (sub === 'ip route') {
      const lines: TerminalLine[] = node.interfaces.map((i) =>
        out(tr('ui.terminal.routeConnected', { net: networkAddress(i.ip, i.prefix), prefix: i.prefix, port: i.port })),
      );
      if (node.gateway) lines.push(out(tr('ui.terminal.routeStatic', { dest: '0.0.0.0', prefix: 0, nextHop: node.gateway })));
      for (const r of node.routes) lines.push(out(tr('ui.terminal.routeStatic', { dest: r.dest, prefix: r.prefix, nextHop: r.nextHop })));
      return lines.length > 0 ? lines : [out(tr('ui.terminal.noRoute'))];
    }
    if (sub === 'mac address-table') {
      // スイッチの MAC の表は、段2の計算（同じ L2 のドメインの端末）から出す。端末では使えない
      if (ctx.data.categoryOf(node.device) !== 'l2_switch') return [err(tr('ui.terminal.noMacTable'))];
      const entries = macTableOf({ nodes: ctx.nodes, links: ctx.links }, ctx.data, node.uid);
      if (entries.length === 0) return [out(tr('ui.terminal.macNone'))];
      return entries.map((e) => out(tr('ui.terminal.macEntry', { port: e.port, mac: e.mac })));
    }
    if (sub === 'ip rip database') {
      const routes = learnedRoutesOf({ nodes: ctx.nodes, links: ctx.links }, ctx.data, node.uid, 'rip');
      if (routes.length === 0) return [out(tr('ui.terminal.ripNone'))];
      return routes.map((r) => out(tr('ui.terminal.ripRoute', { dest: r.dest, prefix: r.prefix, nextHop: r.nextHop })));
    }
    if (sub === 'ip ospf neighbor') {
      const neighbors = ospfNeighborsOf({ nodes: ctx.nodes, links: ctx.links }, ctx.data, node.uid);
      if (neighbors.length === 0) return [out(tr('ui.terminal.ospfNone'))];
      return neighbors.map((nb) => out(tr('ui.terminal.ospfNeighbor', { name: name(ctx.nodes.find((n) => n.uid === nb.uid) ?? node), ip: nb.neighborIp, port: nb.port })));
    }
    if (sub === 'interfaces') {
      const peers = peersOf(ctx);
      const ports = [...new Set([...node.interfaces.map((i) => i.port), ...peers.keys()])].sort((a, b) => a - b);
      if (ports.length === 0) return [out(tr('ui.terminal.noPort'))];
      return ports.map((port) => {
        const iface = node.interfaces.find((i) => i.port === port);
        const peer = peers.get(port);
        const line = !peer
          ? out(tr('ui.terminal.ifFree', { port }))
          : iface
            ? out(tr('ui.terminal.ifLinkedIp', { port, ip: iface.ip, prefix: iface.prefix, peer: name(peer) }))
            : out(tr('ui.terminal.ifLinked', { port, peer: name(peer) }));
        return [line, out(tr('ui.terminal.mac', { port, mac: macOfPort(ctx, port) }))];
      }).flat();
    }
    if (sub === 'arp') {
      const rows = ctx.arp ?? [];
      return rows.length > 0 ? rows.map((r) => out(tr('ui.terminal.arpLine', { ip: r.ip, mac: r.mac }))) : [out(tr('ui.terminal.noArp'))];
    }
    if (sub === 'hosts') {
      const hosts = node.hosts ?? [];
      return hosts.length > 0 ? hosts.map((h) => out(tr('ui.terminal.hostLine', { name: h.name, ip: h.ip }))) : [out(tr('ui.terminal.noHosts'))];
    }
    if (sub === 'running-config') {
      const lines: TerminalLine[] = node.hostname ? [out(tr('ui.terminal.cfgHostname', { name: node.hostname }))] : [];
      for (const i of node.interfaces) lines.push(out(tr('ui.terminal.cfgInterface', { port: i.port })));
      for (const h of node.hosts ?? []) lines.push(out(tr('ui.terminal.cfgHost', { name: h.name, ip: h.ip })));
      if (node.nameServer) lines.push(out(tr('ui.terminal.cfgNameServer', { ip: node.nameServer })));
      for (const i of node.interfaces) lines.push(out(tr('ui.terminal.cfgAddress', { ip: i.ip, prefix: i.prefix })));
      if (node.gateway) lines.push(out(tr('ui.terminal.cfgGateway', { gateway: node.gateway })));
      // 無線（SSID・チャネル・VLAN。パスワードは出さない）と RIP の参加を、設定として出す（N151・N141b）
      if (node.wireless?.ssid !== undefined) lines.push(out(tr('ui.terminal.cfgWireless', { ssid: node.wireless.ssid })));
      if (node.interfaces.some((i) => i.rip === true)) lines.push(out(tr('ui.terminal.cfgRip')));
      for (const r of node.routes) lines.push(out(tr('ui.terminal.cfgRoute', { dest: r.dest, prefix: r.prefix, nextHop: r.nextHop })));
      return lines.length > 0 ? lines : [out(tr('ui.terminal.cfgEmpty'))];
    }
    return [err(tr('ui.terminal.unknown', { cmd: line.trim() }))];
  }

  if (cmd === 'ping' || cmd === 'traceroute') {
    if (args.length !== 1) return [err(tr(cmd === 'ping' ? 'ui.terminal.usagePing' : 'ui.terminal.usageTrace'))];
    // 宛先は IPアドレスか、名前（対応表 → ネームサーバーの順に引く。N68）。名前は1行目に「名前 [IPアドレス]」を出す
    const given = args[0];
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
    const result = ping({ nodes: ctx.nodes, links: ctx.links }, ctx.data, node.uid, target.uid);
    if (result.ok) ctx.onReach?.(target.uid);
    if (cmd === 'ping') {
      if (result.ok) return [...header, out(tr('ui.terminal.pingOk', { ip: given }))];
      const reason = result.failure?.reason ?? 'route.none';
      return [...header, err(tr('ui.terminal.pingNg')), err(tr(`error.${reason}`))];
    }
    // traceroute: 通った機器を1台ずつ、送信元の次から出す。届かなければ止まった場所と理由を出す
    const hops = result.path.slice(1).map((uid, i) => {
      const hop = ctx.nodes.find((n) => n.uid === uid);
      const hopIp = hop?.interfaces[0]?.ip ?? '-';
      return out(tr('ui.terminal.hop', { n: i + 1, ip: hopIp, name: hop ? name(hop) : uid }));
    });
    if (result.ok) return [...header, ...hops];
    const reason = result.failure?.reason ?? 'route.none';
    return [...header, ...hops, err(tr('ui.terminal.traceNg')), err(tr(`error.${reason}`))];
  }

  return [err(tr('ui.terminal.unknown', { cmd }))];
};

// 入力の補完の候補。先頭の語・show の下位・ip の下位の順に、今の入力の続きを探す
const WORDS: Record<string, string[]> = {
  '': ['help', 'show', 'ping', 'traceroute', 'ip', 'no', 'hostname', 'clear'],
  show: ['ip', 'interfaces', 'running-config', 'mac'],
  'show mac': ['address-table'],
  'show ip': ['route', 'ospf'],
  'show ip rip': ['database'],
  'show ip ospf': ['neighbor'],
  ip: ['address', 'default-gateway', 'route'],
  no: ['ip', 'hostname'],
  'no ip': ['default-gateway', 'route'],
};

// 入力の行を補完する。候補が1つなら続きを書き足して末尾に空白を付け、複数なら共通の続きまで書き足す。候補がなければ変えない
export const completeLine = (line: string): string => {
  const trimmedStart = line.replace(/^\s+/, '');
  const endsWithSpace = /\s$/.test(trimmedStart);
  const words = trimmedStart.trim().split(/\s+/).filter((w) => w !== '');
  const typed = endsWithSpace || words.length === 0 ? '' : words[words.length - 1];
  const context = (endsWithSpace || words.length === 0 ? words : words.slice(0, -1)).join(' ');
  const candidates = (WORDS[context] ?? []).filter((w) => w.startsWith(typed));
  if (candidates.length === 0) return line;
  const common = candidates.reduce((a, b) => {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return a.slice(0, i);
  });
  if (candidates.length === 1) {
    const base = endsWithSpace || words.length === 0 ? trimmedStart : trimmedStart.slice(0, trimmedStart.length - typed.length);
    return `${base}${candidates[0]} `;
  }
  if (common.length > typed.length) return `${trimmedStart.slice(0, trimmedStart.length - typed.length)}${common}`;
  return line;
};
