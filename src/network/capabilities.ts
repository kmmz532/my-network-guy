// 機器の能力（NET.md §4）。コードは機器の種類ではなく、定義（devices/*.json）の能力だけを見る（N134）
import { devices } from 'virtual:game-data';
import type { Capability } from '../data/schema';

// 機器の定義から、能力を持つかを見る
export const can = (deviceId: string, capability: Capability): boolean => {
  const def = devices[deviceId as keyof typeof devices] as { capabilities?: readonly string[] } | undefined;
  return def?.capabilities?.includes(capability) ?? false;
};

// 分類（category）の全部の機器が能力を持つか。分類の中で能力がそろっていない（一部だけ持つ）ときは、持たないものとして扱う
export const categoryCan = (category: string, capability: Capability): boolean => {
  const of = Object.values(devices).filter((d) => d.category === category) as { capabilities?: readonly string[] }[];
  return of.length > 0 && of.every((d) => d.capabilities?.includes(capability) ?? false);
};
