// 品目（機器・家具）の絵の名前。インベントリ・店・結果画面で共有する（N56。N16 の重複の整理）。定義がなければ例外にする（R5）
import { devices, furniture } from 'virtual:game-data';

export type ItemKind = 'device' | 'furniture';

export const itemSpriteOf = (kind: ItemKind, id: string): string => {
  const def = kind === 'device' ? devices[id as keyof typeof devices] : furniture[id as keyof typeof furniture];
  if (!def) throw new Error(`品目 ${kind}/${id} の定義がない`);
  return def.sprite;
};
