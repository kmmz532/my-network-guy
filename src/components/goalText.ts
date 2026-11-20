// 達成条件の文言。受注中の案件の一覧と依頼カードで共有する。置換は達成条件の登録表（network/goals.ts）の定義から引く
import type { Goal } from '../data/schema';
import { goalTextSpec } from '../network/goals';
import { tDyn } from '../i18n/t';

// nameOf は機器のID（案件の ref や uid）を表示名に置き換える。なければIDのまま
export const goalText = (goal: Goal, nameOf: (id: string) => string = (id) => id): string => {
  const { key, params } = goalTextSpec(goal, { nameOf, tr: (k) => tDyn(k) });
  return tDyn(key, params);
};
