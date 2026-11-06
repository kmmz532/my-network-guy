// 機器の画面（DevicePanel・DeviceRear・DeviceSettings）で共通に使う、ポートの名前と見た目の部品。
import { t } from '../i18n/t';
import { RADIUS } from '../ui/theme';
import { ROUTER_SWITCH_WAN_PORT } from '../network/category';

// ポートの名前。スイッチは 1 から、ルーターは G0/0 の形、スイッチ付きルーターは WAN と LAN1〜4、PC・サーバーは LAN（ポートの番号は 0 から数える）
export const portLabel = (category: string | undefined, port: number): string => {
  if (category === 'router' || category === 'l3_switch' || category === 'firewall') return t('ui.rear.routerPort', { port });
  if (category === 'router_switch') return port === ROUTER_SWITCH_WAN_PORT ? t('ui.rear.wan') : t('ui.rear.switchLan', { port });
  if (category === 'l2_switch') return String(port + 1);
  return t('ui.rear.lan');
};

// 色の番号（0xRRGGBB）を CSS の色にする
export const hexColor = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

// 画面の欄の文字の大きさは 12 px と 14 px の2種類に寄せる（CORE.md「見た目」）
export const panelStyle = {
  position: 'absolute',
  top: 44,
  right: 8,
  width: 300,
  maxHeight: 'calc(100vh - 150px)',
  overflowY: 'auto',
  background: 'rgba(47, 79, 143, 0.95)',
  color: '#f4f1e6',
  border: '2px solid #3b2a33',
  borderRadius: RADIUS.chrome,
  padding: 8,
  fontSize: 13,
  zIndex: 4,
} as const;

export const inputStyle = { width: 120, background: '#f4f1e6', color: '#3b2a33', border: '1px solid #3b2a33', padding: '1px 4px' } as const;

export const selectStyle = { background: '#f4f1e6', color: '#3b2a33', border: '1px solid #3b2a33', padding: '1px 2px', maxWidth: 150 } as const;

export const buttonStyle = { cursor: 'pointer', padding: '2px 8px', background: '#25406f', color: '#f4f1e6', border: '1px solid #3b2a33', borderRadius: RADIUS.none } as const;

export const sectionStyle = { marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid #3b2a33' } as const;

export const warnColor = '#ffd866';
export const unsetColor = '#ff6b6b';
export const greyColor = '#b8bfcc';

// IPアドレスの形式（各区切りは 0〜255）。入力欄の確かめに使う
export const isIpText = (s: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split('.').every((n) => Number(n) <= 255);
