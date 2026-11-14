// 機材または家具の定価の参照。世界の操作（購入・売却）と画面の両方が使う。
import { deviceDef, furnitureDef, hasDevice, hasFurniture } from '../registry/query';

// 機材または家具の定価（どちらにもないIDは undefined）
export const priceOfItem = (id: string): number | undefined => {
  if (hasFurniture(id)) return furnitureDef(id).price;
  if (hasDevice(id)) return deviceDef(id).price;
  return undefined;
};
