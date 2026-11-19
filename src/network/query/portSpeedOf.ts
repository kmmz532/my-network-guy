// 機器の口の速さ（Mbps）。ターミナルの show interfaces と、機器の画面の背面の口が使う
import { portSpeed } from '../../registry/query';
import type { NetworkState } from '../engine/state';
import type { NetLink } from '../types';

// つながっていれば配線の速さ（無線の仮想の配線など、速さを求めない配線は口の定義の速さ）、つながっていなければ口の定義の速さ。定義もなければ undefined
export const portSpeedOf = (state: NetworkState, links: readonly NetLink[], nodeUid: string, device: string, port: number): number | undefined => {
  const link = links.find((l) => (l.a.node === nodeUid && l.a.port === port) || (l.b.node === nodeUid && l.b.port === port));
  const linkSpeed = link === undefined ? undefined : state.links.speeds.get(link.uid);
  return linkSpeed ?? portSpeed(device, port);
};
