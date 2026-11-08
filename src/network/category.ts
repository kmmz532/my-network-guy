// 機器の種類ごとの扱い（配線・判定・背面の表示で共通に使う）
import { CATEGORY } from '../data/categories';
import { categoryCan } from './capabilities';
import type { PortConfig } from './types';

// SVI（VLAN のインターフェース・N138）は口を持たないため、判定の中だけ仮想の口の番号（1000 + VLAN）で表す
export const SVI_PORT_BASE = 1000;
export const sviPortOf = (vlan: number): number => SVI_PORT_BASE + vlan;
export const isSviPort = (port: number): boolean => port >= SVI_PORT_BASE;

// L3スイッチの口の扱い（N138）: 設定の access・trunk は機器の内部のスイッチ（ファブリック）につなぐ。設定がなく IP もない口は既定の access（VLAN 1）。
// routed の設定、または IP を持つ口（設定がなければ）は、ルーターの口として経路を持つ（今までと同じ動き）
export const isL3FabricPort = (category: string, port: number, cfg: PortConfig | undefined, hasIp: boolean): boolean => {
  // SVI の仮想の口は、口の扱いの対象ではない
  if (category !== CATEGORY.l3Switch || isSviPort(port)) return false;
  if (cfg !== undefined) return cfg.mode === 'access' || cfg.mode === 'trunk';
  return !hasIp;
};
// L2スイッチは中継だけを行い、機器の一員にはならない。
// ルーター系（router・l3_switch・router_switch・firewall。ファイアウォールは2ポートで、通過する経路の印になる）は、ポートごとにネットワークの入口になり、経路を持つ。
// スイッチ付きルーターは、WAN の口（ポート0）と LAN の口（ポート1〜4）を持つ。LAN の口は内部でスイッチとして1つのセグメントになり、代表の LAN 口（ポート1）がそのアドレスを持つ。

export const ROUTER_SWITCH_WAN_PORT = 0;
export const ROUTER_SWITCH_LAN_HOST_PORT = 1;

// 内蔵スイッチを持つルーター（スイッチ付きルーター・家庭用ルーター）。WAN の口0と、内蔵スイッチにつながる LAN の口（1〜）を持つ
export const isSwitchedRouterCategory = (category: string): boolean => category === CATEGORY.routerSwitch || category === CATEGORY.homeRouter;

// L2スイッチ（口を VLAN に分けられる中継機。ルーティングを持たない）。能力（switchport）で決める（N134）
export const isL2Category = (category: string): boolean => categoryCan(category, 'switchport') && !categoryCan(category, 'routing');

// 経路を持つ（ルーティングの能力）。ルーター・L3スイッチ・スイッチ付きルーター・ファイアウォール
export const isRoutingCategory = (category: string): boolean => categoryCan(category, 'routing');

// 中継（機器の内部のスイッチ）でつながる口。L2スイッチのすべての口と、スイッチ付きルーターの LAN の口
// 回線終端（uplink）は、口0（ルーター側）と口1（インターネット側）を素通しする（N144）
export const isFabricPort = (category: string, port: number): boolean =>
  isL2Category(category) || (isSwitchedRouterCategory(category) && port >= ROUTER_SWITCH_LAN_HOST_PORT) || category === CATEGORY.uplink || category === CATEGORY.accessPoint;

// 機器の一員として数えない口（中継だけの口）。代表の LAN 口は一員として数える
export const isRelayPort = (category: string, port: number): boolean =>
  isL2Category(category) || (isSwitchedRouterCategory(category) && port > ROUTER_SWITCH_LAN_HOST_PORT) || category === CATEGORY.uplink || category === CATEGORY.accessPoint;
