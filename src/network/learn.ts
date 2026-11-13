// 通信で覚えること（N69）。ping が通ったとき、送信元の ARP の表と、経路上のスイッチの MAC の表に加える行を求める純粋な関数。
// 表は保存しない（画面の状態として持つ）。学習の材料であり、依頼の目標には使わない。
import { ping } from './engine';
import { isIp } from './terminalConfig';
import { l2Path, learnedOnPath, macOf, type MacEntry } from './mac';
import type { EngineData, NetLink, NetNode } from './types';
import { networkAddress } from './segments';
import { deviceCategory } from '../registry/query';

export interface LearnedPing {
  // 送信元が覚える ARP（次に届ける相手の IPアドレスと MAC）
  arp: { ip: string; mac: string } | null;
  // 経路上のスイッチが覚える MAC
  macs: { switchUid: string; entry: MacEntry }[];
}

const macOfIp = (nodes: readonly NetNode[], ip: string, categoryOf: (device: string) => string): string | null => {
  for (const n of nodes) {
    const port = n.interfaces.find((i) => i.ip === ip);
    if (port) {
      if (n.macSerial === undefined) throw new Error(`MAC アドレスの連番がない機器: ${n.uid}`);
      return macOf(categoryOf(n.device), n.macSerial, port.port);
    }
  }
  return null;
};

// 通信が通ったときの学習。届かなければ何も覚えない（ARP の要求だけは届かない場合も出るが、表には入れない）
export const learnFromPing = (
  nodes: readonly NetNode[],
  links: readonly NetLink[],
  data: EngineData,
  srcUid: string,
  dstUid: string,
): LearnedPing => {
  const none: LearnedPing = { arp: null, macs: [] };
  const src = nodes.find((n) => n.uid === srcUid);
  const dst = nodes.find((n) => n.uid === dstUid);
  if (!src || !dst) return none;
  if (!ping({ nodes: [...nodes], links: [...links] }, data, srcUid, dstUid).ok) return none;

  // 次に届ける相手: 宛先が同じネットワークにいれば宛先、いなければ既定のゲートウェイ
  const dstIp = dst.interfaces[0]?.ip;
  const sameNet = src.interfaces.some((i) => dstIp !== undefined && networkAddress(i.ip, i.prefix) === networkAddress(dstIp, i.prefix));
  const nextIp = sameNet ? dstIp : src.gateway;
  const arpMac = nextIp && isIp(nextIp) ? macOfIp(nodes, nextIp, deviceCategory) : null;
  const arp = nextIp && arpMac ? { ip: nextIp, mac: arpMac } : null;

  const isSwitch = (uid: string): boolean => {
    const n = nodes.find((x) => x.uid === uid);
    return n !== undefined && deviceCategory(n.device) === 'l2_switch';
  };
  const path = l2Path(srcUid, dstUid, nodes, links, isSwitch);
  const macs = path ? learnedOnPath(path, nodes, links, deviceCategory, (n) => isSwitch(n.uid)) : [];
  return { arp, macs };
};
