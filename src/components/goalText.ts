// 達成条件の文言。受注中の案件の一覧と依頼カードで共有する
import type { Goal } from '../data/schema';
import { t, tDyn } from '../i18n/t';

// nameOf は機器のID（案件の ref や uid）を表示名に置き換える。なければIDのまま
export const goalText = (goal: Goal, nameOf: (id: string) => string = (id) => id): string => {
  const params: Record<string, string | number> =
    goal.type === 'ping_all'
      ? { nodes: Array.isArray(goal.nodes) ? goal.nodes.map(nameOf).join('・') : t('ui.task.allPcs') }
      : goal.type === 'count'
        ? { name: tDyn(`category.${goal.category}`), min: goal.min }
        : goal.type === 'count_device'
          ? { name: tDyn(`device.${goal.device}.name`), min: goal.min }
        : goal.type === 'reach_category'
          ? { name: tDyn(`category.${goal.category}`) }
          : goal.type === 'reach_by_name'
            ? { name: goal.name }
          : goal.type === 'http_all' || goal.type === 'firewall'
          ? {}
          : goal.type === 'http_from'
            ? { nodes: goal.nodes.map(nameOf).join('・') }
            : goal.type === 'isolated' || goal.type === 'blocked_all'
              ? { from: goal.from.map(nameOf).join('・'), to: goal.to.map(nameOf).join('・') }
              : { from: nameOf(goal.from), to: nameOf(goal.to) };
  return tDyn(`goal.${goal.type}`, params);
};
