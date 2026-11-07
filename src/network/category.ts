// 機器の種類ごとの扱い（配線・判定・背面の表示で共通に使う）
import { CATEGORY } from '../data/categories';
import { categoryCan } from './capabilities';
// L2スイッチは中継だけを行い、機器の一員にはならない。
// ルーター系（router・l3_switch・router_switch・firewall。ファイアウォールは2ポートで、通過する経路の印になる）は、ポートごとにネットワークの入口になり、経路を持つ。
// スイッチ付きルーターは、WAN の口（ポート0）と LAN の口（ポート1〜4）を持つ。LAN の口は内部でスイッチとして1つのセグメントになり、代表の LAN 口（ポート1）がそのアドレスを持つ。

export const ROUTER_SWITCH_WAN_PORT = 0;
export const ROUTER_SWITCH_LAN_HOST_PORT = 1;

// L2スイッチ（口を VLAN に分けられる中継機。ルーティングを持たない）。能力（switchport）で決める（N134）
export const isL2Category = (category: string): boolean => categoryCan(category, 'switchport') && !categoryCan(category, 'routing');

// 経路を持つ（ルーティングの能力）。ルーター・L3スイッチ・スイッチ付きルーター・ファイアウォール
export const isRoutingCategory = (category: string): boolean => categoryCan(category, 'routing');

// 中継（機器の内部のスイッチ）でつながる口。L2スイッチのすべての口と、スイッチ付きルーターの LAN の口
// 回線終端（uplink）は、口0（ルーター側）と口1（インターネット側）を素通しする（N144）
export const isFabricPort = (category: string, port: number): boolean =>
  isL2Category(category) || (category === CATEGORY.routerSwitch && port >= ROUTER_SWITCH_LAN_HOST_PORT) || category === CATEGORY.uplink;

// 機器の一員として数えない口（中継だけの口）。代表の LAN 口は一員として数える
export const isRelayPort = (category: string, port: number): boolean =>
  isL2Category(category) || (category === CATEGORY.routerSwitch && port > ROUTER_SWITCH_LAN_HOST_PORT) || category === CATEGORY.uplink;
