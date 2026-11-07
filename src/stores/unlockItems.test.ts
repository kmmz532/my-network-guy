// 解放の一覧（レベルアップの報告と、自社の情報の「次に解放される物」の材料）の規則（N127）
import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import type { Balance } from '../data/schema';
import { unlockItems } from './useGameStore';

const balance = balanceJson as unknown as Balance;

describe('機能の解放の一覧（N127）', () => {
  it('balance.featureUnlocks の鍵は、すべて解放の一覧に入る（手で並べない）', () => {
    for (const [id, level] of Object.entries(balance.featureUnlocks)) {
      expect(unlockItems).toContainEqual({ kind: 'feature', id, unlockLevel: level });
    }
  });

});
