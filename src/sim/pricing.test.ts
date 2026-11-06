// 機材の価格の式（N35）。定価が式の値と一致すること、式にない分類・機能は例外にすること
import { describe, expect, it } from 'vitest';
import { devices } from 'virtual:game-data';
import balanceJson from '../assets/data/balance.json';
import type { Balance } from '../data/schema';
import { priceOf } from './pricing';

const balance = balanceJson as unknown as Balance;

describe('機材の価格の式', () => {
  it('すべての機材の定価は、式の値と一致する', () => {
    for (const d of Object.values(devices)) {
      const ports = d.ports.reduce((sum, p) => sum + p.count, 0);
      expect(d.price, `${d.id} の定価`).toBe(priceOf({ category: d.category, ports, features: d.features ?? [] }, balance.pricing));
    }
  });

  it('式にない分類や機能は例外にする（黙って0円にしない）', () => {
    expect(() => priceOf({ category: 'unknown', ports: 1, features: [] }, balance.pricing)).toThrow();
    expect(() => priceOf({ category: 'pc', ports: 1, features: ['nope'] }, balance.pricing)).toThrow();
  });
});
