// 機器を置く位置に関する判定。描画側で共通して使う。
import { isPcDevice } from '../sim/env';
import { deviceDef } from '../registry/query';

// 機器のスプライト（24×40）の足元は、タイルの下端から何 px 上か。
export const DEVICE_FOOT_INSET = 4;
export const DESK_TOP = 18;

export const isPcOnlyDevice = (device: string): boolean =>
  isPcDevice(device) && deviceDef(device).deskable !== true;
