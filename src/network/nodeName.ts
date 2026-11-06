// 機器の表示名。手で付けた名前（node.name）があればそれを使う。
// PC は、座る社員が決まっていれば「{社員名}のPC」、決まっていなければ「PC-1」のように番号で呼ぶ。
// ほかの機器は「サーバー-1」「スイッチ-1」のように、種類ごとの番号で呼ぶ。番号は、同じ種類の機器の中での並び順
import type { NetNode } from './types';
import { CATEGORY } from '../data/categories';

export interface NameContext {
  // 機器の種類（pc・server・l2_switch・router・l3_switch・router_switch・firewall）。ノートPCは pc の種類
  categoryOf: (device: string) => string;
  // 種類の短い呼び名（「PC」「サーバー」「L3スイッチ」など）。種類ごとに番号を振る
  categoryLabel: (category: string) => string;
  // 「{name}のPC」の文言
  ownedPc: (owner: string) => string;
  // その位置の机に座る社員の名前（自社オフィスだけ。なければ null）
  ownerAt?: (x: number, y: number) => string | null;
}

export const nodeName = (node: NetNode, nodes: readonly NetNode[], ctx: NameContext): string => {
  const custom = node.name?.trim();
  if (custom) return custom;
  const category = ctx.categoryOf(node.device);
  if (category === CATEGORY.pc) {
    const owner = ctx.ownerAt?.(node.x, node.y) ?? null;
    if (owner) return ctx.ownedPc(owner);
  }
  const same = nodes.filter((n) => ctx.categoryOf(n.device) === category);
  const index = same.findIndex((n) => n.uid === node.uid);
  return `${ctx.categoryLabel(category)}-${index + 1}`;
};

// 名前を付け直す。空なら手で付けた名前を消し、既定の名前に戻す
export const renameNode = (node: NetNode, name: string): NetNode => {
  const trimmed = name.trim().slice(0, 24);
  const next = { ...node };
  if (trimmed) next.name = trimmed;
  else delete next.name;
  return next;
};
