// 自社オフィスの家具と社員の規則（純粋関数）。配置と撤去、社員の席の数を扱う。
import type { Balance } from '../data/schema';
import { emptyOffice, type Office } from './project';

// 自社オフィスの初期状態。バランス値の初期の机の位置に、机を置く
export const initialOffice = (balance: Balance): Office => {
  const furniture = balance.staff.initialDesks.map((p, i) => ({ uid: `f${i}`, id: 'desk', x: p.x, y: p.y }));
  return { ...emptyOffice(), furniture, furnitureSeq: furniture.length };
};
