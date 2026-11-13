// 構成から、計算の結果を1回だけ求める（操作の直後に呼ぶ）。純粋な関数
import { Topology } from '../netState';
import type { EngineData, Network } from '../types';
import type { NetworkState } from './state';
import { stageAddressing } from './stages/addressing';
import { stageL2 } from './stages/l2';
import { stageLinks } from './stages/links';

export const analyze = (input: Network, world: EngineData): NetworkState => {
  const links = stageLinks(input, world);
  // L2 の層は、アドレスの層の結果を読まない（口にアドレスが残るかの規則を、配線の層の構成に当てて求める）
  const l2 = stageL2(links.net, links);
  const addressing = stageAddressing(input, world, links);
  const topology = new Topology(addressing.net, world, links, l2);
  // DHCP の割り当てを入れた機器の列（Topology の中で解決したもの）
  const net: Network = { ...addressing.net, nodes: topology.allNodes() };
  return { input, world, net, topology, links, l2, addressing, dhcp: topology.dhcp };
};
