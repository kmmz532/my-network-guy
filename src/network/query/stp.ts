// スパニングツリーの問い合わせ（計算の結果から読むだけ）
import type { NetworkState } from '../engine/state';
import type { StpResult } from '../stp';

export const stpOf = (state: NetworkState): StpResult => state.l2.stp();
