// 画面に出す機器の名前。自社オフィス（と自社案件）では、机に座る社員の名前で PC を呼ぶ
import { t, tDyn } from '../i18n/t';
import { nodeName, type NameContext } from '../network/nodeName';
import type { NetNode } from '../network/types';
import { gameEnv } from '../sim/env';
import { focusedProject, type GameState } from '../stores/useGameStore';

const contextFor = (state: GameState, office: boolean): NameContext => ({
  categoryOf: (device) => gameEnv.devices[device]?.category ?? 'unknown',
  categoryLabel: (category) => tDyn(`category.${category}`),
  ownedPc: (owner) => t('ui.node.ownedPc', { name: owner }),
  ownerAt: office
    ? (x, y) => {
        const desks = state.office.furniture.filter((f) => gameEnv.furniture?.[f.id]?.seat === true);
        const index = desks.findIndex((d) => d.x === x && d.y === y);
        const member = index >= 0 ? state.staff[index] : undefined;
        return member ? tDyn(member.name) : null;
      }
    : undefined,
});

// nodes は、その機器が属する一覧（案件の機器か、自社オフィスの機器）
export const nodeLabel = (state: GameState, node: NetNode, nodes: readonly NetNode[]): string => {
  const office = nodes === state.office.nodes || focusedProject(state)?.contract.inhouse === true;
  return nodeName(node, nodes, contextFor(state, office));
};

// uid から名前を引く（見つからなければ uid のまま）
export const labelOfUid = (state: GameState, uid: string, nodes: readonly NetNode[]): string => {
  const node = nodes.find((n) => n.uid === uid);
  return node ? nodeLabel(state, node, nodes) : uid;
};

// 依頼カード（まだ受注していない案件）の機器の名前。案件が最初から置く機器（placed）の並びから番号を付ける
export const offerNodeName = (offer: { contract: { placed: { ref: string; device: string; name?: string }[] } }, ref: string): string => {
  const placed = offer.contract.placed.map((p) => ({ uid: p.ref, device: p.device, ...(p.name ? { name: p.name } : {}), x: 0, y: 0, locked: true, configLocked: false, interfaces: [], gateway: null, routes: [], services: [] }) as NetNode);
  const node = placed.find((n) => n.uid === ref);
  if (!node) return ref;
  return nodeName(node, placed, {
    categoryOf: (device) => gameEnv.devices[device]?.category ?? 'unknown',
    categoryLabel: (category) => tDyn(`category.${category}`),
    ownedPc: (owner) => t('ui.node.ownedPc', { name: owner }),
  });
};
