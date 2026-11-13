import { deviceDef, furnitureDef } from '../registry/query';
// 品目（機器・家具）のアイコンの絵の名前（家具は icon があればそれ、なければ sprite）。インベントリ・店・結果画面で共有する（N56。N16 の重複の整理）。定義がなければ例外にする（R5）

export type ItemKind = 'device' | 'furniture';

export const itemSpriteOf = (kind: ItemKind, id: string): string => {
  const def = kind === 'device' ? deviceDef(id) : furnitureDef(id);
  if (!def) throw new Error(`品目 ${kind}/${id} の定義がない`);
  return 'icon' in def && def.icon !== undefined ? def.icon : def.sprite;
};
