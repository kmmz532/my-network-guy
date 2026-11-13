import type { NetworkState } from '../engine/state';
import { lagBundlesOf } from './lagBundles';

// 機器の口ごとの状態（背面の画面に出す）: 停止・スパニングツリーの役割・リンクアグリゲーションのチャネル
export interface PortState {
  port: number;
  shutdown: boolean;
  // スパニングツリーの役割（スパニングツリーの対象でない口は undefined。まとまった口は代表の口の役割に従う）
  stp?: 'root' | 'designated' | 'blocking';
  // リンクアグリゲーションのチャネルの番号と、まとまっているか
  channel?: { group: number; bundled: boolean };
}
export const portStatesOf = (state: NetworkState, uid: string): PortState[] => {
  const topo = state.topology;
  const node = topo.node(uid);
  if (!node) return [];
  const roles = state.l2.stp().roles;
  const bundled = new Set(lagBundlesOf(state, uid).flatMap((b) => b.links.map((l) => l.uid)));
  return state.input.links
    .filter((l) => l.a.node === uid || l.b.node === uid)
    .map((l) => {
      const port = l.a.node === uid ? l.a.port : l.b.port;
      const cfg = topo.portCfg(uid, port);
      const role = state.l2.isStpBlocked(uid, port) ? 'blocking' : roles.get(`${uid}:${port}`);
      return {
        port,
        shutdown: state.links.isShut(uid, port),
        ...(role === undefined ? {} : { stp: role }),
        ...(cfg?.channelGroup === undefined ? {} : { channel: { group: cfg.channelGroup, bundled: bundled.has(l.uid) } }),
      };
    });
};
