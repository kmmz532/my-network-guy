// 登録表から引く小さな問い合わせ。判定の側はデータの組み立てを持たず、ここから引く。未登録の ID は例外
import { registries } from './game';
import type { CableDef, DeviceDef } from './defs';

// エンジンが回線終端の先に作る、インターネットの仮想の機器。登録表にはなく、分類も専用
export const INTERNET_DEVICE = 'internet';

export const deviceCategory = (device: string): string => (device === INTERNET_DEVICE ? 'internet' : registries.devices.get(device).category);

export const cableMaxLength = (cable: string): number => registries.cables.get(cable).maxLengthTiles;

// 口の速さ（Mbps。口の番号の順）。口の番号が範囲外なら undefined
export const portSpeed = (device: string, port: number): number | undefined => registries.devices.get(device).ports[port]?.speedMbps;

// 機器の定義（登録にない ID は例外）
export const deviceDef = (device: string): DeviceDef => registries.devices.get(device);

// ケーブルの定義（登録にない ID は例外）
export const cableDef = (cable: string): CableDef => registries.cables.get(cable);

// 口の数（1口ずつ数える）
export const portCountOf = (device: string): number => deviceDef(device).ports.length;

// 口の種類（口の番号の順）。範囲外の口は rj45
export const devicePortType = (device: string, port: number): string => deviceDef(device).ports[port]?.type ?? 'rj45';

// 登録にある機器か（未登録は false。配置の判定に使う）
export const hasDevice = (device: string): boolean => registries.devices.has(device);
