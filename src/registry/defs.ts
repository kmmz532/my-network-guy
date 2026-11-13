// 登録表に入れる定義の型。データの読み込みの型（zod）から作る。
import type { Capability, Cable, Device, Furniture } from '../data/schema';

export interface PortDef {
  type: string;
  speedMbps: number;
}

export interface DeviceDef {
  id: string;
  category: Device['category'];
  price: number;
  // 口の番号の順に1口ずつ並べる（rj45 の口の後に sfp の口）
  ports: readonly PortDef[];
  capabilities: ReadonlySet<Capability>;
  deskable: boolean;
  defaultServices: Device['defaultServices'];
}

export type CableDef = Cable;
export type FurnitureDef = Furniture;
