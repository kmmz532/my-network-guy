import type { NetworkState } from '../engine/state';

// ネットワーク全体の中で、輪になっているL2ドメインがあれば、その輪の機器（スイッチ）の uid を返す。なければ null（社内のネットワークの障害の表示に使う）
export const loopNodeOf = (state: NetworkState): string | null => {
  const topo = state.topology;
  for (const link of state.input.links) {
    for (const ep of [link.a, link.b]) {
      const loop = topo.domainOf(ep).loop;
      if (loop) return loop.node;
    }
  }
  return null;
};
