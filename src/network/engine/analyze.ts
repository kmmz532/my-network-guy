// 構成から、計算の結果を1回だけ求める（操作の直後に呼ぶ）。純粋な関数
import { compile } from '../compile';
import { Topology, withWireless } from '../netState';
import type { EngineData, Network } from '../types';
import type { NetworkState } from './state';

export const analyze = (input: Network, world: EngineData): NetworkState => {
  const compiled = compile(input, world);
  const wired = withWireless(compiled.net, world);
  const topology = new Topology(wired, world);
  // DHCP の割り当てを入れた機器の列（Topology の中で解決したもの）
  const net: Network = { ...wired, nodes: topology.allNodes() };
  return { input, world, net, issues: compiled.issues, topology, dhcp: topology.dhcp };
};
