// VLAN の一覧（機器の画面の VLAN のタブ・NET.md §8）。VLAN ごとに、名前と、属するアクセスの口と、通すトランクの口を求める。純粋な関数
import { getComponent } from '../components';
import type { NetNode } from '../types';

export interface VlanRow {
  id: number;
  name: string | null;
  access: number[];
  trunk: number[];
}

// 設定のない口は、アクセスの口として既定の VLAN 1 に属する。トランクの口は、許可の一覧がなければすべての VLAN を通す
export const vlanTableOf = (node: NetNode, portCount: number): VlanRow[] => {
  const defs = getComponent(node, 'vlanDefs') ?? [];
  const cfgOf = (port: number) => node.ports.find((c) => c.port === port);
  const ports = Array.from({ length: portCount }, (_, p) => p);
  const ids = new Set<number>([1, ...defs.map((d) => d.id)]);
  for (const c of node.ports) {
    if (c.mode === 'access' && c.vlan !== undefined) ids.add(c.vlan);
    if (c.mode === 'trunk') for (const v of c.allowed ?? []) ids.add(v);
  }
  return [...ids]
    .sort((a, b) => a - b)
    .map((id) => ({
      id,
      name: defs.find((d) => d.id === id)?.name ?? null,
      access: ports.filter((p) => {
        const c = cfgOf(p);
        return c === undefined ? id === 1 : c.mode === 'access' && (c.vlan ?? 1) === id;
      }),
      trunk: ports.filter((p) => {
        const c = cfgOf(p);
        return c?.mode === 'trunk' && (c.allowed === undefined || c.allowed.includes(id));
      }),
    }));
};
