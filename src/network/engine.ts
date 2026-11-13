// 疎通判定の入口（N136）。転送は engine/forward.ts、層ごとの計算は engine/stages/ にあり、ここから再輸出する
export { backOf, deliver, fail, ping, http } from './engine/forward';
export type { Traffic } from './engine/forward';
export { inSubnet, ipToInt, isPrivateIp } from './ip';
export { adOf } from './engine/stages/routing';
export { dhcpWriteBack } from './engine/analyze';
export { accessPointsOf, linkLength, wallsBetween, WALL_LOSS, WIRELESS_RADIUS, wirelessAssociations, withWireless } from './engine/stages/links';
export type { VlanWarning } from './query/warnings';
