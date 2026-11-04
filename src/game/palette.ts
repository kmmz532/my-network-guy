// サブネットの色（色番号 1〜6）。キャンバスとツールバーで共通に使う
export const SUBNET_COLORS = [0x62c4ff, 0xf2c44e, 0x9b7be0, 0x5aa860, 0xff8fb0, 0xf0a030];

export const subnetColor = (color: number): number => SUBNET_COLORS[(color - 1) % SUBNET_COLORS.length];

export const subnetCss = (color: number): string => `#${subnetColor(color).toString(16).padStart(6, '0')}`;
