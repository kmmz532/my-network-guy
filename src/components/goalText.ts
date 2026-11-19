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
        : goal.type === 'wireless_clients'
          ? { min: goal.min }
        : goal.type === 'outside_reachable' || goal.type === 'wireless_clean' || goal.type === 'qos_voice'
          ? {}
        : goal.type === 'wireless_secure'
          ? { ssid: goal.ssid }
        : goal.type === 'dhcp_all'
          ? { nodes: goal.nodes.map(nameOf).join('・') }
        : goal.type === 'lag_bundled'
          ? { node: nameOf(goal.node), min: goal.min }
        : goal.type === 'stp_root'
          ? { node: nameOf(goal.node) }
        : goal.type === 'public_http'
          ? { to: nameOf(goal.to), port: goal.port }
        : goal.type === 'vpn_up'
          ? (goal.a === undefined || goal.b === undefined ? {} : { a: nameOf(goal.a), b: nameOf(goal.b) })
        : goal.type === 'load_balanced'
          ? { from: nameOf(goal.from), lb: nameOf(goal.lb), minHealthy: goal.minHealthy }
        : goal.type === 'survive_device_failure'
          ? { nodes: goal.nodes.map(nameOf).join('・') }
        : goal.type === 'bgp_established'
          ? { node: nameOf(goal.node), min: goal.min }
        : goal.type === 'survive_uplink_failure'
          ? {}
        : goal.type === 'ospf_dr'
          ? { node: nameOf(goal.node) }
        : goal.type === 'no_static_route'
          ? {}
          : goal.type === 'http_by_name'
            ? { from: goal.from.map(nameOf).join('・'), name: goal.name }
          : goal.type === 'reach_by_name'
            ? { name: goal.name }
          : goal.type === 'resolve_name'
            ? { from: goal.from.map(nameOf).join('・'), name: goal.name }
          : goal.type === 'http_all' || goal.type === 'firewall'
          ? {}
          : goal.type === 'http_from'
            ? { nodes: goal.nodes.map(nameOf).join('・') }
            : goal.type === 'isolated' || goal.type === 'blocked_all'
              ? { from: goal.from.map(nameOf).join('・'), to: goal.to.map(nameOf).join('・') }
              : goal.type === 'min_speed'
                ? { from: nameOf(goal.from), to: nameOf(goal.to), mbps: goal.mbps }
                : { from: nameOf(goal.from), to: nameOf(goal.to) };
  return tDyn(goal.type === 'vpn_up' && goal.a === undefined ? 'goal.vpn_up_any' : `goal.${goal.type}`, params);
};
