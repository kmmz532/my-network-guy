// インターフェースを作る（名前と種類を付ける）。名前は機器の種類の接頭辞と口の番号（N135）。
// PC・サーバー・プリンターは eth（eth0）、ネットワーク機器は g0/（g0/1）
import { devices } from 'virtual:game-data';
import type { Iface } from './types';

const ENDPOINT_CATEGORIES = new Set(['pc', 'server', 'printer']);

export const ifacePrefixOf = (device: string): string => {
  const category = (devices[device as keyof typeof devices] as { category?: string } | undefined)?.category;
  return category !== undefined && ENDPOINT_CATEGORIES.has(category) ? 'eth' : 'g0/';
};

export const makeIface = (device: string, port: number, ip: string, prefix: number): Iface => ({
  id: `${ifacePrefixOf(device)}${port}`,
  kind: 'port',
  port,
  ip,
  prefix,
});
