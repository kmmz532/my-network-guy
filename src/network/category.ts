// 機器の種類ごとの扱い（配線・判定・背面の表示で共通に使う）
// L2スイッチは中継だけを行い、機器の一員にはならない。
// ルーター系（router・l3_switch・router_switch）は、ポートごとにネットワークの入口になり、経路を持つ。
// スイッチ付きルーターは、WAN の口（ポート0）と LAN の口（ポート1〜4）を持つ。LAN の口は内部でスイッチとして1つのセグメントになり、代表の LAN 口（ポート1）がそのアドレスを持つ。

export const ROUTER_SWITCH_WAN_PORT = 0;
export const ROUTER_SWITCH_LAN_HOST_PORT = 1;

export const isL2Category = (category: string): boolean => category === 'l2_switch';

export const isRoutingCategory = (category: string): boolean =>
  category === 'router' || category === 'l3_switch' || category === 'router_switch';

// 中継（機器の内部のスイッチ）でつながる口。L2スイッチのすべての口と、スイッチ付きルーターの LAN の口
export const isFabricPort = (category: string, port: number): boolean =>
  isL2Category(category) || (category === 'router_switch' && port >= ROUTER_SWITCH_LAN_HOST_PORT);

// 機器の一員として数えない口（中継だけの口）。代表の LAN 口は一員として数える
export const isRelayPort = (category: string, port: number): boolean =>
  isL2Category(category) || (category === 'router_switch' && port > ROUTER_SWITCH_LAN_HOST_PORT);
