// 案件の費用（N29）: 機器は、案件で置いた機器の定価の合計と配線の費用。既設・引き継ぎの機器と、購入の代金は含めない
import { describe, expect, it } from 'vitest';
import { projectCostOf, type Project } from './project';
import { deviceDef } from '../registry/query';

// 機器の定価は実データの値（登録表）から引く
const PC = deviceDef('pc_basic').price;
const ROUTER = deviceDef('router_basic').price;
const node = (uid: string, device: string, extra: Record<string, unknown> = {}) => ({ uid, device, locked: false, ...extra });
const project = (over: Partial<Project>): Project => ({ nodes: [], cost: 0, inherited: [], ...over } as unknown as Project);

describe('案件の費用（projectCostOf）', () => {
  it('置いた機器の定価と配線の費用を足す', () => {
    const p = project({ nodes: [node('a', 'pc_basic'), node('b', 'router_basic')] as Project['nodes'], cost: 300 });
    expect(projectCostOf(p)).toEqual({ total: PC + ROUTER + 300, devices: PC + ROUTER, cable: 300 });
  });

  it('既設（locked）と、自社オフィスから引き継いだ機器は含めない', () => {
    const p = project({
      nodes: [node('a', 'pc_basic', { locked: true }), node('b', 'pc_basic'), node('c', 'router_basic')] as Project['nodes'],
      inherited: ['c'],
    });
    expect(projectCostOf(p).devices).toBe(PC);
  });

  it('購入の代金は含めない（費用は cost と置いた機器だけで決まる）', () => {
    const p = project({ nodes: [] as Project['nodes'], cost: 0 });
    expect(projectCostOf(p).total).toBe(0);
  });
});
