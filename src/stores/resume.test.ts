// 起動から再開までの結合テスト（R6）。新しく始める → 依頼が届く → 保存して書き出す → 読み込む → 再開して時間が進む、
// の流れを、実際の store と保存の形式で通す。単体テストが見逃していた「保存の形と読み込みの食い違い」を確かめる。
import { beforeAll, describe, expect, it } from 'vitest';
import { contracts, contractTemplates } from 'virtual:game-data';
import { mapLoaders } from 'virtual:loaders';
import { exportSave, importSave } from '../services/saveFile';
import { useGameStore } from './useGameStore';

const st = () => useGameStore.getState();

beforeAll(async () => {
  const loaded = await Promise.all(Object.values(mapLoaders).map((load) => load()));
  for (const m of loaded) st().cacheMap(m.default);
});

describe('再開の流れ（保存と読み込み）', () => {
  it('依頼のある状態を書き出して読み込むと、依頼と時刻が残り、時間が進む', () => {
    // 依頼が届く状態を作る（前提をそろえ、評判を高くする）
    useGameStore.setState({
      mode: 'career',
      speed: 0,
      completed: contracts.filter((c) => !c.inhouse).map((c) => c.id),
      companyExp: 999,
      offers: [],
      active: [],
      nextOfferMinute: st().clock.minute,
      clock: { ...st().clock, money: 1e12, bankrupt: false },
    });
    st().tick();
    expect(st().offers.length).toBeGreaterThan(0);
    const templateIds = new Set(contractTemplates.map((t) => t.id));
    expect(st().offers.every((o) => o.kind === 'fixed' || templateIds.has(o.baseId))).toBe(true);

    // 保存して書き出し、読み込む（ファイルの形式を通す）
    const before = st().snapshot();
    const text = exportSave(before);
    const restored = importSave(text);
    st().load(restored);
    expect(st().offers.map((o) => o.id)).toEqual((before.offers as { id: string }[]).map((o) => o.id));
    expect(st().clock.minute).toBe(before.clock.minute);
    expect(st().offers.every((o) => (o as { arrivedMinute?: number }).arrivedMinute !== undefined)).toBe(true);

    // 再開して、時間が進み、依頼の一覧が壊れない
    const minute = st().clock.minute;
    useGameStore.setState({ speed: 1 });
    st().tick();
    expect(st().clock.minute).toBeGreaterThan(minute);
    expect(Array.isArray(st().offers)).toBe(true);
  });
});
