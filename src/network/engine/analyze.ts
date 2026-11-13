// 構成から、計算の結果を1回だけ求める（操作の直後に呼ぶ）。純粋な関数
import type { EngineData, Iface, NetLink, NetNode, Network } from '../types';
import type { NetworkState } from './state';
import { stageAddressing } from './stages/addressing';
import { stageL2 } from './stages/l2';
import { stageLinks } from './stages/links';
import { stageRouting } from './stages/routing';

export const analyze = (input: Network, world: EngineData): NetworkState => {
  const links = stageLinks(input, world);
  // L2 の層は、アドレスの層の結果を読まない（口にアドレスが残るかの規則を、配線の層の構成に当てて求める）
  const l2 = stageL2(links.net, links);
  const addressing = stageAddressing(input, links, l2);
  const routing = stageRouting(addressing.net, l2);
  return { input, world, net: addressing.net, links, l2, addressing, routing };
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
