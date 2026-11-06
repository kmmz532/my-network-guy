// 案件の費用（N29）: 機器は、案件で置いた機器の定価の合計と配線の費用。既設・引き継ぎの機器と、購入の代金は含めない
import { describe, expect, it } from 'vitest';
import type { Env } from './project';
import { projectCostOf, type Project } from './project';

const env = { devices: { pc_basic: { price: 1000 }, router_basic: { price: 5000 } } } as unknown as Env;
const node = (uid: string, device: string, extra: Record<string, unknown> = {}) => ({ uid, device, locked: false, ...extra });
const project = (over: Partial<Project>): Project => ({ nodes: [], cost: 0, inherited: [], ...over } as unknown as Project);

describe('案件の費用（projectCostOf）', () => {
  it('置いた機器の定価と配線の費用を足す', () => {
    const p = project({ nodes: [node('a', 'pc_basic'), node('b', 'router_basic')] as Project['nodes'], cost: 300 });
    expect(projectCostOf(p, env)).toEqual({ total: 6300, devices: 6000, cable: 300 });
  });

  it('既設（locked）と、自社オフィスから引き継いだ機器は含めない', () => {
    const p = project({
      nodes: [node('a', 'pc_basic', { locked: true }), node('b', 'pc_basic'), node('c', 'router_basic')] as Project['nodes'],
      inherited: ['c'],
    });
    expect(projectCostOf(p, env).devices).toBe(1000);
  });

  it('購入の代金は含めない（費用は cost と置いた機器だけで決まる）', () => {
    const p = project({ nodes: [] as Project['nodes'], cost: 0 });
    expect(projectCostOf(p, env).total).toBe(0);
  });
});
