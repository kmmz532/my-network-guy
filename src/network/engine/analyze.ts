// 構成から、計算の結果を1回だけ求める（操作の直後に呼ぶ）。純粋な関数
import { compile } from '../compile';
import { Topology } from '../netState';
import type { EngineData, Network } from '../types';
import type { NetworkState } from './state';
import { stageLinks } from './stages/links';

export const analyze = (input: Network, world: EngineData): NetworkState => {
  const compiled = compile(input, world);
  const links = stageLinks(input, world);
  // 無線の仮想の配線と口の設定は、段Aの構成から取り、compile の補完を入れた機器に重ねる
  const portsOf = new Map(links.net.nodes.map((n) => [n.uid, n.ports]));
  const wired: Network = { ...compiled.net, nodes: compiled.net.nodes.map((n) => (portsOf.get(n.uid) === n.ports ? n : { ...n, ports: portsOf.get(n.uid) ?? n.ports })), links: links.net.links };
  const topology = new Topology(wired, world, links);
  // DHCP の割り当てを入れた機器の列（Topology の中で解決したもの）
  const net: Network = { ...wired, nodes: topology.allNodes() };
  return { input, world, net, issues: compiled.issues, topology, links, dhcp: topology.dhcp };
};
