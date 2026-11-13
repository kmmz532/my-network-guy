// 登録表から引く小さな問い合わせ。判定の側はデータの組み立てを持たず、ここから引く。未登録の ID は例外
import { registries } from './game';

// エンジンが回線終端の先に作る、インターネットの仮想の機器。登録表にはなく、分類も専用
export const INTERNET_DEVICE = 'internet';

export const deviceCategory = (device: string): string => (device === INTERNET_DEVICE ? 'internet' : registries.devices.get(device).category);

export const cableMaxLength = (cable: string): number => registries.cables.get(cable).maxLengthTiles;

// 口の速さ（Mbps。口の番号の順）。口の番号が範囲外なら undefined
export const portSpeed = (device: string, port: number): number | undefined => registries.devices.get(device).ports[port]?.speedMbps;
