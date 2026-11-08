// 機器を置く位置に関する判定。描画側で共通して使う。
import { gameEnv, isPcDevice } from '../sim/env';

export const DEVICE_FOOT_INSET = 4;
export const DESK_TOP = 18;

export const isPcOnlyDevice = (device: string): boolean =>
  isPcDevice(device) && gameEnv.devices[device]?.deskable !== true;
