// 達成条件の文言。受注中の案件の一覧と依頼カードで共有する
import type { Goal } from '../data/schema';
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';

// nameOf は機器のID（案件の ref や uid）を表示名に置き換える。なければIDのまま
export const goalText = (goal: Goal, nameOf: (id: string) => string = (id) => id): string => {
  const params: Record<string, string | number> =
    goal.type === 'ping_all'
      ? { nodes: Array.isArray(goal.nodes) ? goal.nodes.map(nameOf).join('・') : t('ui.task.allPcs') }
      : goal.type === 'count'
        ? { name: t(`category.${goal.category}` as LangKey), min: goal.min }
        : goal.type === 'http_all' || goal.type === 'firewall'
          ? {}
          : { from: nameOf(goal.from), to: nameOf(goal.to) };
  return t(`goal.${goal.type}` as LangKey, params);
};
