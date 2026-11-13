// 挙動の記録: ネットワークの構成から、外から見える結果（疎通・show の出力・ケーブルの色・口の状態・不備と警告）を決まった形で求める。
// 記録は JSON にし、機器と配線は uid の順に並べる（記録の差分を読めるようにする）
import { can } from '../network/capabilities';
import { compile } from '../network/compile';
import { colorOfLink, networkColors } from '../network/netColor';
import { http, ping, warningsOf, withWireless } from '../network/netState';
import { portStatesOf } from '../network/query/portStates';
import { analyze } from '../network/engine/analyze';
import { runTerminal } from '../network/terminal';
import type { EngineData, Network } from '../network/types';

// 文言を引かず、キーと引数をそのまま並べる（言語ファイルの文言の変更で記録が変わらないようにする）
const tr = (key: string, params?: Record<string, string | number>): string => (params ? `${key} ${JSON.stringify(params)}` : key);

// 端末（PC・サーバー・ノートPC）: スイッチの口もルーテッドポートも持たず、口を持つ機器
const isEnd = (n: Network['nodes'][number]): boolean => n.interfaces.length > 0 && !can(n.device, 'switchport') && !can(n.device, 'routedPort');

// その機器で使える show の命令
const showsOf = (device: string): string[] => [
  ...(can(device, 'routedPort') || can(device, 'routing') ? ['show ip route'] : []),
  ...(can(device, 'vlan') ? ['show vlan brief'] : []),
  ...(can(device, 'stp') ? ['show spanning-tree'] : []),
  ...(can(device, 'ospf') ? ['show ip ospf neighbor'] : []),
  ...(can(device, 'bgp') ? ['show ip bgp'] : []),
  ...(can(device, 'vrrp') ? ['show vrrp'] : []),
  ...(can(device, 'lag') ? ['show etherchannel summary'] : []),
  ...(can(device, 'services') ? ['show ip dhcp binding'] : []),
  ...(can(device, 'nat') ? ['show ip nat translations'] : []),
  ...(can(device, 'switchport') ? ['show mac address-table'] : []),
];

export const recordOf = (input: Network, engine: EngineData) => {
  const sorted: Network = {
    ...input,
    nodes: [...input.nodes].sort((a, b) => a.uid.localeCompare(b.uid)),
    links: [...input.links].sort((a, b) => a.uid.localeCompare(b.uid)),
  };
  const compiled = compile(sorted, engine);
  const net = compiled.net;
  const ends = net.nodes.filter(isEnd);
  const servers = ends.filter((n) => n.services.length > 0);
  const pings = ends.flatMap((a) =>
    ends
      .filter((b) => a.uid !== b.uid)
      .map((b) => {
        const r = ping(net, engine, a.uid, b.uid);
        return { from: a.uid, to: b.uid, ok: r.ok, reason: r.failure?.reason ?? null, path: r.path };
      }),
  );
  const https = ends.flatMap((a) =>
    servers
      .filter((s) => s.uid !== a.uid)
      .map((s) => {
        const r = http(net, engine, a.uid, s.uid, 80);
        return { from: a.uid, to: s.uid, ok: r.ok, reason: r.failure?.reason ?? null };
      }),
  );
  const shows = net.nodes.flatMap((n) =>
    showsOf(n.device).map((cmd) => ({ node: n.uid, cmd, lines: runTerminal(cmd, { node: n, nodes: net.nodes, links: net.links, data: engine }, tr).map((l) => `${l.kind}:${l.text}`) })),
  );
  const colors = networkColors(withWireless(net, engine), engine);
  return {
    pings,
    https,
    shows,
    colors: net.links.map((l) => ({ link: l.uid, color: colorOfLink(colors, l.uid) })),
    ports: net.nodes.map((n) => ({ node: n.uid, ports: [...portStatesOf(analyze(net, engine), n.uid)].sort((a, b) => a.port - b.port) })),
    issues: Object.entries(compiled.issues).sort(([a], [b]) => a.localeCompare(b)),
    warnings: warningsOf(net, engine),
  };
};
