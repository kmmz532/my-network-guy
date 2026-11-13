// 画面・描画から読んでよい、ネットワークの入口。計算の結果（NetworkState）と query の関数だけを再輸出する
export type { NetworkState } from './engine/state';
export { stpOf } from './query/stp';
export { bgpTableOf } from './query/bgpTable';
export { ospfMismatchesOf } from './query/ospfMismatches';
export { ospfNeighborsOf } from './query/ospfNeighbors';
export { vrrpStatusOf } from './query/vrrpStatus';
export { macTableOf } from './query/macTable';
export { portStatesOf, type PortState } from './query/portStates';
export { lagBundlesOf } from './query/lagBundles';
