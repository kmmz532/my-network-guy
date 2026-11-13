// ネットワークの計算の結果（段2）。2a の間は、今の Topology を包んで持つ
import type { DhcpResult } from '../dhcp';
import type { IssueDetail } from '../compile';
import type { Topology } from '../netState';
import type { EngineData, Network } from '../types';

export interface NetworkState {
  // 保存の構成（操作が変えるもの）
  readonly input: Network;
  readonly world: EngineData;
  // compile の後、無線の仮想の配線と DHCP の割り当てを入れた構成
  readonly net: Network;
  // compile の問題（設計の不備）
  readonly issues: Readonly<Record<string, IssueDetail>>;
  // 今の計算の本体（2c-4 で消す）
  readonly topology: Topology;
  // DHCP の割り当ての結果（topology.dhcp と同じもの）
  readonly dhcp: DhcpResult;
}
