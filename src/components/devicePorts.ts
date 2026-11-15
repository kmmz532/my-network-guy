// 機器の画面（DevicePanel・DeviceRear・DeviceSettings）で共通に使う、ポートの名前と入力の確かめ。
import { t } from '../i18n/t';
import { isL2Category, isSwitchedRouterCategory, ROUTER_SWITCH_WAN_PORT } from '../network/category';
import { categoryCan } from '../network/capabilities';

// ポートの名前。スイッチは 1 から、ルーターは G0/0 の形、スイッチ付きルーターは WAN と LAN1〜4、PC・サーバーは LAN（ポートの番号は 0 から数える）
export const portLabel = (category: string | undefined, port: number): string => {
  if (category !== undefined && categoryCan(category, 'routedPort')) return t('ui.rear.routerPort', { port });
  if (category !== undefined && isSwitchedRouterCategory(category)) return port === ROUTER_SWITCH_WAN_PORT ? t('ui.rear.wan') : t('ui.rear.switchLan', { port });
  if (category !== undefined && isL2Category(category)) return String(port + 1);
  return t('ui.rear.lan');
};

// IPアドレスの形式（各区切りは 0〜255）。入力欄の確かめに使う
export const isIpText = (s: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split('.').every((n) => Number(n) <= 255);
