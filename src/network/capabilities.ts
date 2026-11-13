// 機器の能力（NET.md §4）。コードは機器の種類ではなく、定義（devices/*.json）の能力だけを見る（N134）
import type { Capability } from '../data/schema';
import { registries } from '../registry/game';

// 機器の定義から、能力を持つかを見る。
// 暫定: 未登録の ID は、試験が架空の ID を使っているため false にしている。1-3 で試験を実在の ID に替えた後に例外にする
export const can = (deviceId: string, capability: Capability): boolean =>
  registries.devices.has(deviceId) && registries.devices.get(deviceId).capabilities.has(capability);

// 分類（category）の全部の機器が能力を持つか。分類の中で能力がそろっていない（一部だけ持つ）ときは、持たないものとして扱う
export const categoryCan = (category: string, capability: Capability): boolean => {
  const of = registries.devices.all().filter((d) => d.category === category);
  return of.length > 0 && of.every((d) => d.capabilities.has(capability));
};
