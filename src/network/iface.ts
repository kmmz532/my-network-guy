// インターフェースを作る（名前と種類を付ける）。名前は機器の種類の接頭辞と口の番号（N135）。
// PC・サーバー・プリンターは eth（eth0）、ネットワーク機器は g0/（g0/1）
import { PO_PORT, type Iface } from './types';
import { sviPortOf } from './category';
import { can } from './capabilities';

export const ifacePrefixOf = (device: string): string => {
  return can(device, 'endpoint') ? 'eth' : 'g0/';
};

// VLAN のインターフェース（SVI・N138）。名前は vlan10 の形
export const makeSvi = (vlan: number, ip: string, prefix: number): Iface => ({
  id: `vlan${vlan}`,
  kind: 'svi',
  port: sviPortOf(vlan),
  vlan,
  ip,
  prefix,
});

// 束ねた口のインターフェース（Po）。名前は Po1 の形。物理の口は持たない
export const makePo = (channel: number, ip: string, prefix: number): Iface => ({
  id: `Po${channel}`,
  kind: 'po',
  port: PO_PORT,
  channel,
  ip,
  prefix,
});

export const makeIface = (device: string, port: number, ip: string, prefix: number): Iface => ({
  id: `${ifacePrefixOf(device)}${port}`,
  kind: 'port',
  port,
  ip,
  prefix,
});
