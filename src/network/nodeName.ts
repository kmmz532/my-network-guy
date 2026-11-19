// 機器の表示名。手で付けた名前（node.name）があればそれを使う。
// PC は、座る社員が決まっていれば「{社員名}のPC」、決まっていなければ「PC-1」のように番号で呼ぶ。
// サーバーは、動いているサービスで呼ぶ（「Webサーバー-1」「複合サーバー-2」。サービスがなければ「サーバー-1」）。番号は、同じ名前の機器の中での並び順
// ほかの機器は「スイッチ-1」「L3スイッチ-1」のように、種類ごとの番号で呼ぶ。番号は、同じ種類の機器の中での並び順
import type { NetNode, Service } from './types';
import { CATEGORY, isPcCategory } from '../data/categories';
import { getComponent } from './components';

export interface NameContext {
  // 機器の種類（pc・server・l2_switch・router・l3_switch・router_switch・firewall）。ノートPCは pc の種類
  categoryOf: (device: string) => string;
  // 種類の短い呼び名（「PC」「サーバー」「L3スイッチ」など）。種類ごとに番号を振る
  categoryLabel: (category: string) => string;
  // 品目の名前（「エッジルーター」「SFP対応ルーター」など）。あれば、PC・サーバー以外はこれを使い、品目ごとに番号を振る
  deviceLabel?: (device: string) => string;
  // 「{name}のPC」の文言
  ownedPc: (owner: string) => string;
  // その位置の机に座る社員の名前（自社オフィスだけ。なければ null）
  ownerAt?: (x: number, y: number) => string | null;
  // 文言キー（言語ファイル）を文言にする。サーバーの役割の名前に使う
  tr: (key: string) => string;
}

// 動いているサービスの種類 → サーバーの役割の名前の文言キー。サービスの種類を足したら、ここにも足す
export type ServerRole = Service['protocol'] | 'dhcp';
const SERVICE_NAME_KEY: Record<ServerRole, string> = {
  dhcp: 'ui.node.role.dhcp',
  http: 'ui.node.role.web',
  dns: 'ui.node.role.dns',
  radius: 'ui.node.role.radius',
  proxy: 'ui.node.role.proxy',
};
const MULTI_NAME_KEY = 'ui.node.role.multi';

// サーバーの役割: 動いているサービスと、DHCP サーバーの設定（サービスの一覧ではなく部品で持つ）。サーバー以外は空。名前と印の両方がこれを使う
export const serverRolesOf = (node: NetNode, categoryOf: (device: string) => string): ServerRole[] => {
  if (categoryOf(node.device) !== CATEGORY.server) return [];
  const dhcp = (getComponent(node, 'dhcpServer') ?? []).length > 0 ? (['dhcp'] as const) : [];
  return [...node.services.map((s) => s.protocol), ...dhcp];
};

// サーバーの名前（番号なし）。役割がなければ種類の名前、1つなら役割の名前、2つ以上なら複合サーバー
const serverBaseName = (node: NetNode, ctx: NameContext): string => {
  const roles = serverRolesOf(node, ctx.categoryOf);
  if (roles.length === 0) return ctx.categoryLabel(CATEGORY.server);
  if (roles.length >= 2) return ctx.tr(MULTI_NAME_KEY);
  return ctx.tr(SERVICE_NAME_KEY[roles[0]]);
};

export const nodeName = (node: NetNode, nodes: readonly NetNode[], ctx: NameContext): string => {
  const custom = node.name?.trim();
  if (custom) return custom;
  const category = ctx.categoryOf(node.device);
  if (isPcCategory(category)) {
    const owner = ctx.ownerAt?.(node.x, node.y) ?? null;
    if (owner) return ctx.ownedPc(owner);
  }
  if (category === CATEGORY.server) {
    // サービスで決まる名前が同じサーバーの中での並び順で番号を振る（サービスを外すと、名前も戻る）
    const base = serverBaseName(node, ctx);
    const same = nodes.filter((n) => ctx.categoryOf(n.device) === CATEGORY.server && serverBaseName(n, ctx) === base);
    return `${base}-${same.findIndex((n) => n.uid === node.uid) + 1}`;
  }
  if (ctx.deviceLabel && !isPcCategory(category)) {
    // 同じ種類でも品目が違えば別の名前になる（エッジルーターと SFP対応ルーターなど）
    const label = ctx.deviceLabel(node.device);
    const sameDevice = nodes.filter((n) => n.device === node.device);
    const index = sameDevice.findIndex((n) => n.uid === node.uid);
    return `${label}${index + 1}`;
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
