// 起動の順序を通す結合テスト（R6）。App の起動と同じく、地図をすべて読み込んでから依頼を判定する。
// 単体テストは地図を1つずつ用意するため、「地図が読み込まれていないひな形が黙って届かない」不具合を見逃していた。
import { beforeAll, describe, expect, it } from 'vitest';
import { contracts, contractTemplates } from 'virtual:game-data';
import { mapLoaders } from 'virtual:loaders';
import { useGameStore } from './useGameStore';

const st = () => useGameStore.getState();

beforeAll(async () => {
  // App の起動と同じ: すべての地図を読み込み、store に入れる
  const loaded = await Promise.all(Object.values(mapLoaders).map((load) => load()));
  for (const m of loaded) st().cacheMap(m.default);
});

describe('起動の順序: 依頼の判定', () => {
  it('すべての地図が読み込まれている（定型案件の地図が候補から外れない）', () => {
    for (const t of contractTemplates) {
      expect(st().maps[t.map], `${t.id} の地図 ${t.map}`).toBeDefined();
    }
  });

  it('条件がそろえば、どの地図の定型案件も依頼に届く', () => {
    // 前提をすべて満たし、評判を最高にして、依頼が毎回届くようにする
    const completed = contracts.map((c) => c.id);
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      useGameStore.setState({
        mode: 'career',
        speed: 1,
        completed,
        reputation: 999,
        offers: [],
        active: [],
        nextOfferMinute: st().clock.minute,
        clock: { ...st().clock, money: 1e12, bankrupt: false },
      });
      st().tick();
      for (const o of st().offers) seen.add(o.baseId);
    }
    const templateIds = contractTemplates.map((t) => t.id);
    // 地図が違う定型案件（小規模LAN以外）も届く
    const twoRooms = contractTemplates.filter((t) => t.map !== 'office_small').map((t) => t.id);
    expect(twoRooms.length).toBeGreaterThan(0);
    expect(twoRooms.some((id) => seen.has(id))).toBe(true);
    expect(templateIds.some((id) => seen.has(id))).toBe(true);
  });
});
