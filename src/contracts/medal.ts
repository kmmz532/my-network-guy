// 勲章。挑戦の依頼を★3で納品すると、型紙ごとに1つ得る。報酬は付けない。勲章の名前は型紙の名前（台数は範囲で入れる）
import { contractTemplates } from 'virtual:game-data';
import { tDyn } from '../i18n/t';
import { pcCountRangeOf } from './spawn';

export const medalNameOf = (baseId: string): string => {
  const template = contractTemplates.find((c) => c.id === baseId);
  if (!template) throw new Error(`勲章の型紙がない: ${baseId}`);
  const { min, max } = pcCountRangeOf(template);
  return tDyn(`contract.${baseId}.title`, { pcCount: min === max ? String(min) : `${min}〜${max}` });
};
