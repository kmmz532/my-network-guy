import type { NetworkState } from '../engine/state';

// スイッチの MAC の表（show mac address-table）: 口ごとに、同じ L2 のドメインにつながった端末の MAC（構成から求めた結果。ping の学習ではない）
export const macTableOf = (state: NetworkState, uid: string): { port: number; mac: string }[] => state.l2.macTable(uid);
