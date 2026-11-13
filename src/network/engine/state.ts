// ネットワークの計算の結果。NetworkState が Topology を包む間は、Topology と層を並べて持つ
import type { DhcpResult } from '../dhcp';
import type { IssueDetail } from '../compile';
import type { Topology } from '../netState';
import type { L2Layer } from './stages/l2';
import type { LinkLayer } from './stages/links';
import type { EngineData, Network } from '../types';

export interface NetworkState {
  // 保存の構成（操作が変えるもの）
  readonly input: Network;
  readonly world: EngineData;
  // compile の後、無線の仮想の配線と DHCP の割り当てを入れた構成
  readonly net: Network;
  // compile の問題（設計の不備）
  readonly issues: Readonly<Record<string, IssueDetail>>;
  // 配線の層: 無線の結びつき・論理リンク・口の停止・配線の長さの超過
  readonly links: LinkLayer;
  // L2 の層: L2 ドメイン・スパニングツリー・MAC の表
  readonly l2: L2Layer;
  // 今の計算の本体（層への分割が済めば消す）
  readonly topology: Topology;
  // DHCP の割り当ての結果（topology.dhcp と同じもの）
  readonly dhcp: DhcpResult;
}
