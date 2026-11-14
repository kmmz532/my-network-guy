import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import type { AutoSaveMode } from '../settings/settings';
import { createSaveSession } from './saveSession';
import type { Company } from '../world/world';

const day = 24 * 60;

// ゲームのストアの代わり（セーブが見る項目だけ）
interface FakeGame {
  clock: { minute: number; bankrupt: boolean };
  lastReport: { passed: boolean } | null;
  snapshot: () => Company;
  load: (data: Company) => void;
}

const setup = (mode: AutoSaveMode = 'daily') => {
  const writes: { slot: number; data: Company }[] = [];
  const loaded: Company[] = [];
  const game = create<FakeGame>(() => ({
    clock: { minute: day - 60, bankrupt: false },
    lastReport: null,
    snapshot: () => ({ name: 'テスト社' }) as unknown as Company,
    load: (data) => loaded.push(data),
  }));
  let fail = false;
  const session = createSaveSession({
    write: async (slot, data) => {
      if (fail) throw new Error('書けない');
      writes.push({ slot, data });
    },
    game: game as never,
    autoSaveMode: () => mode,
    now: () => 1234,
  });
  return { session, game, writes, loaded, failNext: () => (fail = true) };
};

// Node のテストでは document と window がないため、イベントだけ受け取れるものを置く
let doc: EventTarget & { visibilityState: string };
beforeEach(() => {
  doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => vi.unstubAllGlobals());

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('saveSession（遊んでいる会社のセーブ）', () => {
  it('枠を決めずに保存すると例外にする', async () => {
    const { session } = setup();
    await expect(session.save()).rejects.toThrow();
  });

  it('保存は、開いた枠に書く。倒産した後は書かずに false を返す', async () => {
    const { session, game, writes } = setup();
    session.open(3);
    expect(await session.save()).toBe(true);
    expect(writes.map((w) => w.slot)).toEqual([3]);
    game.setState({ clock: { minute: 0, bankrupt: true } });
    expect(await session.save()).toBe(false);
    expect(writes).toHaveLength(1);
  });

  it('見張っている間、朝0時を越えたら自動保存し、保存の印の時刻を持つ', async () => {
    const { session, game, writes } = setup();
    session.open(1);
    const stop = session.watch();
    game.setState({ clock: { minute: day + 10, bankrupt: false } });
    await flush();
    expect(writes).toHaveLength(1);
    expect(session.view.getState().savedAt).toBe(1234);
    stop();
    game.setState({ clock: { minute: 2 * day + 10, bankrupt: false } });
    await flush();
    expect(writes).toHaveLength(1);
  });

  it('検収に通った報告が届いたとき、ページを隠したときに自動保存する', async () => {
    const { session, game, writes } = setup();
    session.open(1);
    const stop = session.watch();
    game.setState({ lastReport: { passed: false } });
    await flush();
    expect(writes).toHaveLength(0);
    game.setState({ lastReport: { passed: true } });
    await flush();
    expect(writes).toHaveLength(1);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(writes).toHaveLength(2);
    stop();
  });

  it('設定が「しない」のときは自動保存しない', async () => {
    const { session, game, writes } = setup('off');
    session.open(1);
    const stop = session.watch();
    game.setState({ clock: { minute: day + 10, bankrupt: false } });
    await flush();
    expect(writes).toHaveLength(0);
    stop();
  });

  it('自動保存に失敗したら failed を立てる', async () => {
    const { session, failNext } = setup();
    session.open(1);
    failNext();
    await session.autoSave();
    expect(session.view.getState()).toMatchObject({ failed: true, savedAt: null });
  });

  it('書き出しは倒産した後は null。形の合わない内容は読み込まずに例外にする', () => {
    const { session, game, loaded } = setup();
    expect(session.exportText()).not.toBeNull();
    expect(() => session.importText('{}')).toThrow();
    expect(loaded).toHaveLength(0);
    game.setState({ clock: { minute: 0, bankrupt: true } });
    expect(session.exportText()).toBeNull();
  });
});
