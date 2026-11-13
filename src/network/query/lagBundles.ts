// リンクアグリゲーションで、機器 uid を含むまとまった論理リンク（show etherchannel summary に出す）
import type { NetworkState } from '../engine/state';
import type { LagBundle } from '../lag';

export const lagBundlesOf = (state: NetworkState, uid: string): LagBundle[] =>
  state.links.lag.bundles.filter((b) => b.a === uid || b.b === uid);
