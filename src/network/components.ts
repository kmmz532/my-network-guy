// 機器の単位の設定を、能力ごとのコンポーネントの表（NetNode.components）で持つ。
// 持てるコンポーネントは機器の定義（能力）が決め、持てない機器に付けようとすれば例外で止める。
import { z } from 'zod';
import type { Capability } from '../data/schema';
import { ipv4 } from '../data/schema';
import { can } from './capabilities';
import type { NetNode } from './types';

// コンポーネントごとの zod のスキーマ。型もここから決める
export const COMPONENT_SCHEMAS = {
  // OSPF の機器ごとの設定（routerId は省略すると自動。defaultOriginate は既定の経路を配る。process は router ospf の番号。省略は番号を書いていない）
  ospf: z.object({ routerId: ipv4.optional(), defaultOriginate: z.boolean().optional(), process: z.number().int().nonnegative().optional() }),
};

export type ComponentId = keyof typeof COMPONENT_SCHEMAS;
export type Components = { [K in ComponentId]?: z.infer<(typeof COMPONENT_SCHEMAS)[K]> };

// コンポーネントを持てる条件（機器の定義の能力）
const REQUIRES: Record<ComponentId, Capability> = {
  ospf: 'ospf',
};

export const getComponent = <K extends ComponentId>(node: NetNode, id: K): Components[K] => node.components?.[id];

// コンポーネントを付けた（置き換えた）機器を返す。機器の定義が許さなければ例外
export const withComponent = <K extends ComponentId>(node: NetNode, id: K, value: NonNullable<Components[K]>): NetNode => {
  if (!can(node.device, REQUIRES[id])) throw new Error(`機器 ${node.device} は ${id} のコンポーネントを持てない`);
  return { ...node, components: { ...node.components, [id]: COMPONENT_SCHEMAS[id].parse(value) } };
};
