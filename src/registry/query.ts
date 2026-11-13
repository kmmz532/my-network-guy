// 登録表から引く小さな問い合わせ。判定の側はデータの組み立てを持たず、ここから引く。未登録の ID は例外
import { registries } from './game';
import type { CableDef, DeviceDef, FurnitureDef } from './defs';

// エンジンが回線終端の先に作る、インターネットの仮想の機器。登録表にはなく、分類も専用
export const INTERNET_DEVICE = 'internet';

export const deviceCategory = (device: string): string => (device === INTERNET_DEVICE ? 'internet' : registries.devices.get(device).category);

export const cableMaxLength = (cable: string): number => registries.cables.get(cable).maxLengthTiles;

// 口の速さ（Mbps。口の番号の順）。口の番号が範囲外なら undefined
export const portSpeed = (device: string, port: number): number | undefined => registries.devices.get(device).portSpeeds[port];

// 機器の定義（登録にない ID は例外）
export const deviceDef = (device: string): DeviceDef => registries.devices.get(device);

// ケーブルの定義（登録にない ID は例外）
export const cableDef = (cable: string): CableDef => registries.cables.get(cable);

// 口の数（1口ずつ数える）
// 口の数。インターネットの仮想の機器は口を持たない
export const portCountOf = (device: string): number => (device === INTERNET_DEVICE ? 0 : deviceDef(device).portCount);

// 機器の価格。インターネットの仮想の機器は 0
export const devicePrice = (device: string): number => (device === INTERNET_DEVICE ? 0 : deviceDef(device).price);

// 口の種類（口の番号の順）。範囲外の口は rj45
export const devicePortType = (device: string, port: number): string => (device === INTERNET_DEVICE ? 'rj45' : deviceDef(device).portTypes[port] ?? 'rj45');

// 登録にある機器か（未登録は false。配置の判定に使う）
export const hasDevice = (device: string): boolean => registries.devices.has(device);

// 機器の定義を探す（登録にない ID は undefined）。種類を確かめながら引く箇所に使う
export const maybeDevice = (device: string): DeviceDef | undefined => (registries.devices.has(device) ? registries.devices.get(device) : undefined);

// ケーブルの定義を探す（登録にない ID は undefined）
export const maybeCable = (cable: string): CableDef | undefined => (registries.cables.has(cable) ? registries.cables.get(cable) : undefined);

// 家具の定義を探す（登録にない ID は undefined）
export const maybeFurniture = (id: string): FurnitureDef | undefined => (registries.furniture.has(id) ? registries.furniture.get(id) : undefined);

// 登録にある家具か
export const hasFurniture = (id: string): boolean => registries.furniture.has(id);

// 登録にあるケーブルか
export const hasCable = (cable: string): boolean => registries.cables.has(cable);

// 家具の定義（登録にない ID は例外）
export const furnitureDef = (id: string): FurnitureDef => registries.furniture.get(id);

// ID から引ける記録（登録表から作る。記録を値として渡す箇所に使う）
export const devicesById: Record<string, DeviceDef> = Object.fromEntries(registries.devices.all().map((d) => [d.id, d]));
export const cablesById: Record<string, CableDef> = Object.fromEntries(registries.cables.all().map((c) => [c.id, c]));
export const furnitureById: Record<string, FurnitureDef> = Object.fromEntries(registries.furniture.all().map((f) => [f.id, f]));
