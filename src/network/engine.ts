// 疎通判定の入口（N136）。計算は netState.ts の段（配線→L2→IP→経路→転送）で行い、ここから再輸出する
// 名前を挙げて再輸出する（読み込みが循環しても、呼ぶ時点の値を読む）
export { accessPointsOf, adOf, backOf, deliver, dhcpWriteBack, fail, inSubnet, ipToInt, isPrivateIp, linkLength, ospfPeersOf, Topology, wallsBetween, WALL_LOSS, WIRELESS_RADIUS, wirelessAssociations, withWireless } from './netState';
export type { OspfPeer, Traffic, VlanWarning } from './netState';
export { ping, http } from './engine/forward';
