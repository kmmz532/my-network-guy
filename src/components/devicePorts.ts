// 機器の画面（DevicePanel・DeviceRear・DeviceSettings）で共通に使う、ポートの名前と入力の確かめ。
import { t } from '../i18n/t';
import { isL2Category, isSwitchedRouterCategory, ROUTER_SWITCH_WAN_PORT } from '../network/category';
import { categoryCan } from '../network/capabilities';

// WAN の口か。機器の定義が wan の能力を持つ内蔵スイッチ付きルーター（家庭用ルーター・スイッチ付きルーター）の口0
export const isWanPort = (category: string | undefined, port: number): boolean =>
  category !== undefined && categoryCan(category, 'wan') && isSwitchedRouterCategory(category) && port === ROUTER_SWITCH_WAN_PORT;

// ポートの名前。命令の口の番号と同じ 0 から数える（L2スイッチは番号だけ、ルーターは G0/0 の形、スイッチ付きルーターは WAN と LAN1〜4、PC・サーバーは LAN）
export const portLabel = (category: string | undefined, port: number): string => {
  if (category !== undefined && categoryCan(category, 'routedPort')) return t('ui.rear.routerPort', { port });
  if (isWanPort(category, port)) return t('ui.rear.wan');
  if (category !== undefined && isSwitchedRouterCategory(category)) return t('ui.rear.switchLan', { port });
  if (category !== undefined && isL2Category(category)) return String(port);
  return t('ui.rear.lan');
};

// IPアドレスの形式（各区切りは 0〜255）。入力欄の確かめに使う
export const isIpText = (s: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split('.').every((n) => Number(n) <= 255);

// 背面と口の一覧に描く口の絵（空いた口。差してある口はこの上にプラグの影を重ねる）
export const plugSlot = (link: { cable: string } | undefined, sfp: boolean): string => (!link ? (sfp ? 'rear/port_sfp_empty' : 'rear/port_empty') : link.cable.startsWith('fiber') ? 'rear/port_sfp_empty' : 'rear/port_empty');
