// ネットワークの計算の結果。NetworkState が Topology を包む間は、Topology と層を並べて持つ
import type { Topology } from '../netState';
import type { RoutingLayer } from './stages/routing';
import type { AddressLayer } from './stages/addressing';
import type { L2Layer } from './stages/l2';
import type { LinkLayer } from './stages/links';
import type { EngineData, Network } from '../types';

export interface NetworkState {
  // 保存の構成（操作が変えるもの）
  readonly input: Network;
  readonly world: EngineData;
  // アドレスを補完し、無線の仮想の配線と DHCP の割り当てを入れた構成（addressing.net と同じもの）
  readonly net: Network;
  // 配線の層: 無線の結びつき・論理リンク・口の停止・配線の長さの超過
  readonly links: LinkLayer;
  // L2 の層: L2 ドメイン・スパニングツリー・MAC の表
  readonly l2: L2Layer;
  // アドレスの層: 実効の口のアドレス・ゲートウェイの補完・DHCP の割り当て・VRRP の持ち主・設計の不備
  readonly addressing: AddressLayer;
  // 経路の層: 機器ごとの経路表（静的・RIP・OSPF・BGP）・OSPF の隣接・BGP のセッション
  readonly routing: RoutingLayer;
  // 今の計算の本体（層への分割が済めば消す）
  readonly topology: Topology;
}
