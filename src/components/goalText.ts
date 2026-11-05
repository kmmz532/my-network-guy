// 達成条件の文言。受注中の案件の一覧と依頼カードで共有する
import type { Goal } from '../data/schema';
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';

export const goalText = (goal: Goal): string => {
  const params: Record<string, string | number> =
    goal.type === 'ping_all'
      ? { nodes: Array.isArray(goal.nodes) ? goal.nodes.join('・') : t('ui.task.allPcs') }
      : goal.type === 'count'
        ? { name: t(`category.${goal.category}` as LangKey), min: goal.min }
        : goal.type === 'http_all'
          ? {}
          : { from: goal.from, to: goal.to };
  return t(`goal.${goal.type}` as LangKey, params);
};
