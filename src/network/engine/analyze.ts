// 構成から、計算の結果を1回だけ求める（操作の直後に呼ぶ）。純粋な関数
import { can } from '../capabilities';
import { getComponent } from '../components';
import { isEapSecurity } from '../../registry/wireless';
import { radiusQuery } from './forward';
import type { EngineData, Iface, NetLink, NetNode, Network } from '../types';
import type { NetworkState } from './state';
import { stageAddressing } from './stages/addressing';
import { stageL2 } from './stages/l2';
import { stageLinks } from './stages/links';
import { stageRouting } from './stages/routing';

const compute = (input: Network, world: EngineData, radiusDown: ReadonlySet<string>): NetworkState => {
  const links = stageLinks(input, world, radiusDown);
  // L2 の層は、アドレスの層の結果を読まない（口にアドレスが残るかの規則を、配線の層の構成に当てて求める）
  const l2 = stageL2(links.net, links);
  const addressing = stageAddressing(input, links, l2);
  const routing = stageRouting(addressing.net, l2, links);
  return { input, world, net: addressing.net, links, l2, addressing, routing };
};

// 802.1X の SSID のアクセスポイントのうち、RADIUS サーバーへ届かないもの
const radiusDownOf = (state: NetworkState): Set<string> =>
  new Set(
    state.input.nodes
      .filter((n) => can(n.device, 'accessPoint') && isEapSecurity(getComponent(n, 'wireless')?.security ?? 'wpa2'))
      .filter((n) => !radiusQuery(state, n.uid, getComponent(n, 'wireless')?.radius).ok)
      .map((n) => n.uid),
  );

// 無線のつながりは、RADIUS への到達（配線・アドレス・経路の後に決まる）に左右される。循環を避けるため、
// まず全部の端末がつながるものとして計算し、802.1X の SSID の RADIUS に届かないアクセスポイントを求めて、あれば端末をつながない構成で計算し直す。
// 到達はアクセスポイントの有線側だけで決まり、無線の端末のつながりに左右されないため、2回目の結果は1回目の判定と食い違わない
export const analyze = (input: Network, world: EngineData): NetworkState => {
  const first = compute(input, world, new Set());
  const down = radiusDownOf(first);
  return down.size === 0 ? first : compute(input, world, down);
};

// 受け取れた自動の口の ip・prefix を機器へ書き戻す（前回のアドレスとして保存する）。変わる機器がなければ同じ配列を返す
export const dhcpWriteBack = <T extends { uid: string; interfaces: Iface[] }>(nodes: readonly T[], links: readonly NetLink[], plans: Network['plans'], data: EngineData): readonly T[] => {
  if (!nodes.some((n) => n.interfaces.some((i) => i.dhcp === true))) return nodes;
  const leases = analyze({ nodes: nodes as unknown as NetNode[], links: [...links], plans }, data).addressing.dhcp.leases;
  let changed = false;
  const next = nodes.map((n) => {
    const interfaces = n.interfaces.map((i) => {
      const l = i.dhcp === true ? leases.find((x) => x.uid === n.uid && x.port === i.port) : undefined;
      if (!l || (l.ip === i.ip && l.prefix === i.prefix)) return i;
      changed = true;
      return { ...i, ip: l.ip, prefix: l.prefix };
    });
    return interfaces.some((i, k) => i !== n.interfaces[k]) ? { ...n, interfaces } : n;
  });
  return changed ? next : nodes;
};
