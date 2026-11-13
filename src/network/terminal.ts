// 機器のターミナルのコマンド。入力の行を受け取り、出力の行を返す（画面には出さない純粋な関数）。
// 確認のコマンド: help・show ip・show ip route・show interfaces・show running-config・ping・traceroute。
// 補完（Tab）と、clear・hostname は、それぞれ別の関数で扱う（ここでは help の文言だけ）。
// 文言は tr（言語ファイルの引き当て）で作る。モードは持たない。
import { ping } from './engine';
import { analyze } from './engine/analyze';
import { stpOf } from './query/stp';
import { networkAddress } from './segments';
import { isIp } from './terminalConfig';
import { resolveName } from './resolve';
import { macOf, type MacEntry } from './mac';
import type { EngineData, NetLink, NetNode } from './types';
import { bgpTableOf } from './query/bgpTable';
import { adOf, dhcpOf, lagBundlesOf, learnedRoutesOf, macTableOf } from './netState';
import { vrrpStatusOf } from './query/vrrpStatus';
import { ospfNeighborsOf } from './query/ospfNeighbors';
import { ospfMismatchesOf } from './query/ospfMismatches';
import type { Trace } from '../sim/project';
import { framesOf } from './frames';
import { isL2Category, isRoutingCategory } from './category';
import { deviceCategory } from '../registry/query';

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
  // ping・traceroute の経路を画面上でパケットとして流す
  onTrace?: (trace: Trace) => void;
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
  return macOf(deviceCategory(ctx.node.device), ctx.node.macSerial, port);
};

export const runTerminal = (line: string, ctx: TerminalContext, tr: Tr): TerminalLine[] => {
  const out = (text: string): TerminalLine => ({ text, kind: 'out' });
  const err = (text: string): TerminalLine => ({ text, kind: 'err' });
  const expanded = expandAbbrev(line);
  if (!expanded.ok) return [err(tr('ui.terminal.ambiguous'))];
  const words = expanded.line.split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return [];
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
      // 静的経路は S（既定の経路は S*）。各行に [管理距離/メトリック] を出す
      const ad = adOf({ dest: '', prefix: 0, nextHop: '', protocol: 'static' });
      if (node.gateway) lines.push(out(tr('ui.terminal.routeStaticDefault', { dest: '0.0.0.0', prefix: 0, nextHop: node.gateway, ad, metric: 0 })));
      for (const r of node.routes) lines.push(out(tr(r.prefix === 0 ? 'ui.terminal.routeStaticDefault' : 'ui.terminal.routeStatic', { dest: r.dest, prefix: r.prefix, nextHop: r.nextHop, ad, metric: 0 })));
      for (const protocol of ['rip', 'ospf', 'bgp'] as const) {
        for (const r of learnedRoutesOf({ nodes: ctx.nodes, links: ctx.links }, ctx.data, node.uid, protocol)) {
          const key = protocol === 'ospf' && r.interArea ? 'ui.terminal.routeOspfIa' : `ui.terminal.route${protocol[0].toUpperCase()}${protocol.slice(1)}`;
          lines.push(out(tr(key, { dest: r.dest, prefix: r.prefix, nextHop: r.nextHop, ad: adOf(r), metric: r.metric ?? 0 })));
        }
      }
      return lines.length > 0 ? lines : [out(tr('ui.terminal.noRoute'))];
    }
    if (sub === 'mac address-table') {
      // スイッチの MAC の表は、段2の計算（同じ L2 のドメインの端末）から出す。端末では使えない
      if (deviceCategory(node.device) !== 'l2_switch') return [err(tr('ui.terminal.noMacTable'))];
      const entries = macTableOf({ nodes: ctx.nodes, links: ctx.links }, ctx.data, node.uid);
      if (entries.length === 0) return [out(tr('ui.terminal.macNone'))];
      return entries.map((e) => out(tr('ui.terminal.macEntry', { port: e.port, mac: e.mac })));
    }
    if (sub === 'ip rip database') {
      const routes = learnedRoutesOf({ nodes: ctx.nodes, links: ctx.links }, ctx.data, node.uid, 'rip');
      if (routes.length === 0) return [out(tr('ui.terminal.ripNone'))];
      return routes.map((r) => out(tr('ui.terminal.ripRoute', { dest: r.dest, prefix: r.prefix, nextHop: r.nextHop })));
    }
    if (sub === 'ip nat translations') {
      // 設定から決まる変換（静的 NAT の転送と、NAPT の変換先）を出す。通信ごとの変換は保存しないため出さない（N146）
      const outside = node.interfaces.find((i) => i.nat === 'outside');
      const statics = node.statics ?? [];
      if (!node.napt && statics.length === 0) return [out(tr('ui.terminal.natNone'))];
      if (!outside) return [err(tr('ui.terminal.natNoOutside'))];
      const lines: TerminalLine[] = statics.map((s) =>
        out(tr('ui.terminal.natStatic', { outsideIp: outside.ip, outsidePort: s.port, insideIp: s.insideIp, insidePort: s.insidePort })),
      );
      if (node.napt) lines.push(out(tr('ui.terminal.natNapt', { outsideIp: outside.ip })));
      // 4 つの欄（内部グローバル・内部ローカル・外部ローカル・外部グローバル）の見出しを先頭に出す
      return [out(tr('ui.terminal.natHeader')), ...lines];
    }
    if (sub === 'vrrp') {
      const groups = vrrpStatusOf(analyze({ nodes: ctx.nodes, links: ctx.links }, ctx.data), node.uid);
      if (groups.length === 0) return [out(tr('ui.terminal.vrrpNone'))];
      return groups.map((g) => out(tr('ui.terminal.vrrpGroup', { iface: g.iface, vrid: g.vrid, state: g.state, ip: g.ip, priority: g.priority, preempt: tr(g.preempt ? 'ui.terminal.vrrpPreemptOn' : 'ui.terminal.vrrpPreemptOff') })));
    }
    if (sub === 'ip dhcp binding') {
      // 配ったアドレス（このサーバーが配ったもの）。割り当ては毎回計算で求める（NET.md §5.7）
      const leases = dhcpOf({ nodes: ctx.nodes, links: ctx.links }, ctx.data).leases.filter((l) => l.server === node.uid);
      if (leases.length === 0) return [out(tr('ui.terminal.dhcpNone'))];
      return leases.map((l) => out(tr('ui.terminal.dhcpBinding', { ip: l.ip, name: name(ctx.nodes.find((n) => n.uid === l.uid) ?? node), port: l.port })));
    }
    if (sub === 'etherchannel summary') {
      // 設定のある口を、チャネルごとに出す。まとまった口に (P)、まとまらない口に (I)（NET.md §5.1）
      const configured = node.ports.filter((p) => p.channelGroup !== undefined).sort((a, b) => a.port - b.port);
      if (configured.length === 0) return [out(tr('ui.terminal.channelNone'))];
      const bundled = new Set(lagBundlesOf({ nodes: ctx.nodes, links: ctx.links }, node.uid, ctx.data).flatMap((b) => b.links.flatMap((l) => [l.a, l.b])).filter((e) => e.node === node.uid).map((e) => e.port));
      return [...new Set(configured.map((p) => p.channelGroup as number))].map((group) => {
        const ports = configured.filter((p) => p.channelGroup === group);
        const state = ports.some((p) => bundled.has(p.port)) ? 'P' : 'D';
        return out(tr('ui.terminal.channelLine', { group, state, lacp: ports[0].lacp ?? '', ports: ports.map((p) => `${p.port}(${bundled.has(p.port) ? 'P' : 'I'})`).join(' ') }));
      });
    }
    if (sub === 'spanning-tree') {
      const net = { nodes: ctx.nodes, links: ctx.links };
      const stp = stpOf(analyze(net, ctx.data));
      if (stp.root === null || !stp.rootCost.has(node.uid)) return [err(tr('ui.terminal.stpOff'))];
      const lines = [out(tr(stp.root === node.uid ? 'ui.terminal.stpIsRoot' : 'ui.terminal.stpRoot', { root: name(ctx.nodes.find((n) => n.uid === stp.root) ?? node), cost: stp.rootCost.get(node.uid) ?? 0 }))];
      const mine = [...stp.roles.entries()].filter(([k]) => k.startsWith(`${node.uid}:`)).map(([k, role]) => ({ port: Number(k.split(':')[1]), role })).sort((a, b) => a.port - b.port);
      for (const p of mine) lines.push(out(tr(`ui.terminal.stpPort.${p.role}`, { port: p.port })));
      return lines;
    }
    if (sub === 'vlan brief' || sub === 'vlan') {
      // 口ごとの VLAN の設定（設定のない口は既定の VLAN 1）
      const cfgs = [...node.ports].sort((a, b) => a.port - b.port);
      if (cfgs.length === 0) return [out(tr('ui.terminal.vlanNone'))];
      return cfgs.map((c) =>
        out(
          c.mode === 'access'
            ? tr('ui.terminal.vlanAccess', { port: c.port, vlan: c.vlan ?? 1 })
            : c.mode === 'trunk'
              ? tr('ui.terminal.vlanTrunk', { port: c.port, allowed: c.allowed === undefined ? tr('ui.terminal.vlanAll') : c.allowed.join(','), native: c.native ?? 1 })
              : tr('ui.terminal.vlanRouted', { port: c.port }),
        ),
      );
    }
    if (sub === 'ip bgp summary' || sub === 'ip bgp') {
      const bgp = bgpTableOf(analyze({ nodes: ctx.nodes, links: ctx.links }, ctx.data), node.uid);
      if (!bgp) return [err(tr('ui.terminal.bgpOff'))];
      if (sub === 'ip bgp summary') {
        if (bgp.sessions.length === 0) return [out(tr('ui.terminal.bgpNone'))];
        return bgp.sessions.map((s) =>
          out(tr('ui.terminal.bgpSession', { ip: s.ip, as: s.remoteAs, kind: tr(s.ebgp ? 'ui.terminal.bgpEbgp' : 'ui.terminal.bgpIbgp'), state: s.status.state === 'established' ? tr('ui.terminal.bgpEstablished') : tr(`ui.terminal.bgpIdle.${s.status.reason}`) })),
        );
      }
      const lines = bgp.candidates.map((c) =>
        out(tr('ui.terminal.bgpRoute', { mark: `${c.best ? '>' : ' '}${c.valid ? '*' : ' '}`, dest: c.dest, prefix: c.prefix, nextHop: c.nextHop ?? '0.0.0.0', lp: c.localPref, med: c.med, path: c.path.join(' ') || 'i' })),
      );
      return lines.length > 0 ? [out(tr('ui.terminal.bgpHeader')), ...lines] : [out(tr('ui.terminal.bgpNone'))];
    }
    if (sub === 'ip ospf neighbor') {
      const neighbors = ospfNeighborsOf(analyze({ nodes: ctx.nodes, links: ctx.links }, ctx.data), node.uid);
      const nameOfUid = (uid: string) => name(ctx.nodes.find((n) => n.uid === uid) ?? node);
      if (neighbors.length === 0) {
        // 隣接がないときは、条件が合わなかった相手と理由を出す
        const mismatches = ospfMismatchesOf(analyze({ nodes: ctx.nodes, links: ctx.links }, ctx.data), node.uid);
        if (mismatches.length === 0) return [out(tr('ui.terminal.ospfNone'))];
        return mismatches.map((m) => out(tr('ui.terminal.ospfMismatch', { name: nameOfUid(m.uid), ip: m.neighborIp, reason: tr(`ui.terminal.ospfMismatch.${m.mismatch}`) })));
      }
      return neighbors.map((nb) => out(tr('ui.terminal.ospfNeighbor', { name: nameOfUid(nb.uid), ip: nb.neighborIp, port: nb.port, routerId: nb.routerId, priority: nb.priority, state: nb.state })));
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
    ctx.onTrace?.({ kind: 'ping', src: node.uid, dst: target.uid, result });
    if (result.ok) ctx.onReach?.(target.uid);
    if (cmd === 'ping') {
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
  'show ip': ['route', 'ospf', 'nat'],
  'show ip nat': ['translations'],
  'show ip rip': ['database'],
  'show ip ospf': ['neighbor'],
  ip: ['address', 'default-gateway', 'route'],
  no: ['ip', 'hostname'],
  'no ip': ['default-gateway', 'route'],
};

// 略記を正式な語に直す（Cisco と同じく、語が一意に決まるときだけ）。その語のあとに続く語も、同じ表で直す。
// 一意に決まらない略記があれば ambiguous を返し、何も展開しない。表にない語は、そのまま残す
export type Expanded = { ok: true; line: string } | { ok: false; reason: 'ambiguous' };
export const expandAbbrev = (line: string): Expanded => {
  const words = line.trim().split(/\s+/).filter((w) => w !== '');
  const out: string[] = [];
  let context = '';
  for (const word of words) {
    const candidates = (WORDS[context] ?? []).filter((w) => w.startsWith(word));
    if (candidates.includes(word)) {
      out.push(word);
      context = context === '' ? word : `${context} ${word}`;
    } else if (candidates.length === 1) {
      out.push(candidates[0]);
      context = context === '' ? candidates[0] : `${context} ${candidates[0]}`;
    } else if (candidates.length > 1) {
      return { ok: false, reason: 'ambiguous' };
    } else {
      // 表にない語（機器の名前・アドレスなど）は、そのまま残す。以降は表で直さない
      out.push(word);
      context = '\u0000';
    }
  }
  return { ok: true, line: out.join(' ') };
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
