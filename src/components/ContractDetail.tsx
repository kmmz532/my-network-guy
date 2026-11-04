import type { LangKey } from '../generated/lang-keys';
import type { Contract, Goal } from '../data/schema';
import { hasKey, t } from '../i18n/t';
import type { GoalStatus } from '../sim/status';

interface Props {
  contract: Contract;
  baseId: string;
  params: Record<string, number>;
  // 受注中の案件のみ、現在の設計での達成状況を渡す
  statuses?: GoalStatus[];
}

// 機器のIDは、案件の中での名前（ref）と機材の名前で表す
const nameOf = (contract: Contract, ref: string): string => {
  const placed = contract.placed.find((p) => p.ref === ref);
  if (!placed) return ref;
  return `${t(`device.${placed.device}.name` as LangKey)}（${ref}）`;
};

const goalText = (contract: Contract, goal: Goal): string => {
  switch (goal.type) {
    case 'ping':
      return t('goal.ping', { from: nameOf(contract, goal.from), to: nameOf(contract, goal.to) });
    case 'ping_all': {
      const nodes = goal.nodes === '$all_pcs' ? [] : goal.nodes;
      return t('goal.ping_all', { nodes: nodes.map((n) => nameOf(contract, n)).join('、') });
    }
    case 'http':
      return t('goal.http', { from: nameOf(contract, goal.from), to: nameOf(contract, goal.to) });
  }
};

// 依頼文・達成条件・ヒントを表示する。受注中は各条件の達成状況も出す
export function ContractDetail({ contract, baseId, params, statuses }: Props) {
  const hintKey = `contract.${baseId}.hint`;
  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ opacity: 0.9, marginBottom: 6 }}>{t(`contract.${baseId}.story` as LangKey, params)}</div>
      <div>{t('ui.contract.goals')}</div>
      <ul style={{ margin: '4px 0 6px', paddingLeft: 18 }}>
        {contract.goals.map((goal, i) => {
          const status = statuses?.[i];
          return (
            <li key={i}>
              {status && (
                <span style={{ color: status.ok ? '#62d26f' : '#ffcc33', marginRight: 4 }}>
                  {status.ok ? t('ui.contract.ok') : t('ui.contract.ng')}
                </span>
              )}
              <span>{goalText(contract, goal)}</span>
              {status &&
                status.reasons.map((reason) => (
                  <div key={reason} style={{ color: '#ffcc33', fontSize: 12 }}>
                    {t(`error.${reason}` as LangKey)}
                  </div>
                ))}
            </li>
          );
        })}
      </ul>
      {hasKey(hintKey) && <div style={{ opacity: 0.9 }}>{t('ui.contract.hint', { text: t(hintKey as LangKey) })}</div>}
    </div>
  );
}
