// 機器の能力（N134）。能力の判定と、定義の矛盾の検査を確かめる
import { describe, expect, it } from 'vitest';
import { deviceSchema } from '../data/schema';
import { can, categoryCan } from './capabilities';
import { isL2Category, isRoutingCategory } from './category';

const base = { id: 'x', category: 'l2_switch', price: 1000, ports: [{ type: 'rj45', count: 8, speedMbps: 100 }], sprite: 'device/x', unlockLevel: 1 };

describe('機器の能力', () => {
  it('能力は定義どおりに判定する（経路・VLAN・L2）', () => {
    expect(can('l3_switch', 'routing')).toBe(true);
    expect(can('pc_basic', 'routing')).toBe(false);
    expect(can('l2_switch_4p', 'vlan')).toBe(false);
    expect(can('l2_switch_8p', 'vlan')).toBe(true);
    expect(can('router_basic', 'wan')).toBe(true);
    expect(can('l3_switch', 'wan')).toBe(false);
  });

  it('分類の判定は、能力から決まる（経路を持つ分類・L2の分類）', () => {
    for (const c of ['router', 'l3_switch', 'router_switch', 'firewall']) expect(isRoutingCategory(c)).toBe(true);
    for (const c of ['pc', 'server', 'printer', 'l2_switch']) expect(isRoutingCategory(c)).toBe(false);
    expect(isL2Category('l2_switch')).toBe(true);
    expect(isL2Category('l3_switch')).toBe(false);
    expect(categoryCan('printer', 'routing')).toBe(false);
  });

  it('定義にない能力や、矛盾した組み合わせは読み込みで止める', () => {
    expect(deviceSchema.safeParse({ ...base, capabilities: ['warp'] }).success).toBe(false);
    expect(deviceSchema.safeParse({ ...base, capabilities: ['svi'], sviMax: 1 }).success).toBe(false);
    expect(deviceSchema.safeParse({ ...base, capabilities: ['switchport', 'svi'] }).success).toBe(false);
    expect(deviceSchema.safeParse({ ...base, capabilities: ['switchport', 'svi'], sviMax: 1 }).success).toBe(true);
    expect(deviceSchema.safeParse({ ...base, capabilities: ['subif'] }).success).toBe(false);
    expect(deviceSchema.safeParse({ ...base, capabilities: ['routedPort', 'subif'] }).success).toBe(true);
    expect(deviceSchema.safeParse({ ...base, capabilities: ['nat'] }).success).toBe(false);
  });
});
