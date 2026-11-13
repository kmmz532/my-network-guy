// 登録表に入れる定義の型。データの読み込みの型（zod）の項目をすべて持ち、そこから導いた項目を足す。
import type { Cable, Capability, Device, Furniture } from '../data/schema';

// 機器の定義。zod の項目はそのまま持つ。能力の集合・口の数と口ごとの種類・速さは、読み込みで導く
export interface DeviceDef extends Omit<Device, 'capabilities'> {
  capabilities: ReadonlySet<Capability>;
  // 口の数（1口ずつ数える）
  portCount: number;
  // 口の種類・速さ（Mbps）。口の番号の順に1口ずつ並べる（rj45 の口の後に sfp の口）
  portTypes: readonly string[];
  portSpeeds: readonly number[];
}

export type CableDef = Cable;
export type FurnitureDef = Furniture;
