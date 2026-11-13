// リンクアグリゲーションで、機器 uid を含むまとまった論理リンク（show etherchannel summary に出す）
import type { NetworkState } from '../engine/state';
import { can } from '../capabilities';
import type { LagBundle } from '../lag';
import { computeLags } from '../lag';
import { portSpeed } from '../../registry/query';

export const lagBundlesOf = (state: NetworkState, uid: string): LagBundle[] =>
  computeLags(state.input.nodes, state.input.links, (n) => can(n.device, 'lag'), (n, port) => portSpeed(n.device, port)).bundles.filter((b) => b.a === uid || b.b === uid);
