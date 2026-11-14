// タイトル場面の流れ（何を出すか・どこへ移るか）
import { describe, expect, it } from 'vitest';
import type { CompanySave } from '../services/companies';
import type { World } from '../world/world';
import { initialTitleState, titleReducer, type TitleEvent, type TitleState } from './titleFlow';

const save = (slot: number, name: string): CompanySave => ({ slot, savedAt: 0, data: { name } as unknown as World });
const run = (events: TitleEvent[], from: TitleState = initialTitleState): TitleState => events.reduce(titleReducer, from);

const CAREER_FULL = [11, 12, 13, 14, 15].map((slot) => save(slot, `会社${slot}`));
const SANDBOX_FULL = [21, 22, 23].map((slot) => save(slot, `箱${slot}`));

describe('titleReducer（タイトル場面の流れ）', () => {
  it('最初はメニュー', () => {
    expect(initialTitleState.panel).toEqual({ kind: 'menu' });
  });

  it('新しく始める: 空いた枠があれば社名を決める画面へ（空いた最小の枠・既定の社名）', () => {
    const s = run([{ type: 'newCareer', saves: [save(11, 'A')] }]);
    expect(s.mode).toBe('career');
    expect(s.panel).toEqual({ kind: 'slots', view: { kind: 'name', slot: 12, suggested: expect.any(String), from: 'new' } });
  });

  it('新しく始める: 枠が全部埋まっていれば、上書きする会社を選ぶ一覧へ', () => {
    const s = run([{ type: 'newCareer', saves: CAREER_FULL }]);
    expect(s.panel).toEqual({ kind: 'slots', view: { kind: 'list', purpose: 'overwrite' } });
  });

  it('コンティニュー: 保存がなければメニューのまま知らせを出す。あれば一覧を開く', () => {
    const none = run([{ type: 'continueCareer', saves: [], noneMessage: 'なし' }]);
    expect(none.panel).toEqual({ kind: 'menu' });
    expect(none.message).toBe('なし');
    const some = run([{ type: 'continueCareer', saves: [save(11, 'A')], noneMessage: 'なし' }]);
    expect(some.panel).toEqual({ kind: 'slots', view: { kind: 'list', purpose: 'play' } });
  });

  it('サンドボックス: 保存があれば一覧、なければ広さを選ぶ', () => {
    expect(run([{ type: 'sandbox', saves: [save(21, 'A')] }]).panel).toEqual({ kind: 'slots', view: { kind: 'list', purpose: 'play' } });
    const empty = run([{ type: 'sandbox', saves: [] }]);
    expect(empty.mode).toBe('sandbox');
    expect(empty.panel).toEqual({ kind: 'sandboxSize' });
  });

  it('広さを決めたサンドボックスは社名を決める。枠が全部埋まっていれば上書きの一覧', () => {
    expect(run([{ type: 'sandboxSized', saves: [] }]).panel).toMatchObject({ kind: 'slots', view: { kind: 'name', slot: 21, from: 'new' } });
    expect(run([{ type: 'sandboxSized', saves: SANDBOX_FULL }]).panel).toEqual({ kind: 'slots', view: { kind: 'list', purpose: 'overwrite' } });
  });

  it('画面を閉じるとメニューに戻り、読み込み中の会社は捨てる', () => {
    const held = run([{ type: 'importHeld', data: { name: 'X' } as unknown as World, saves: CAREER_FULL, notice: '満杯' }]);
    expect(held.pendingImport).not.toBeNull();
    expect(held.panel).toEqual({ kind: 'slots', view: { kind: 'list', purpose: 'overwrite' } });
    expect(held.notice).toBe('満杯');
    const closed = run([{ type: 'show', view: null }], held);
    expect(closed.panel).toEqual({ kind: 'menu' });
    expect(closed.pendingImport).toBeNull();
  });

  it('枠の画面の中の移り変わり（変更・消す）', () => {
    const target = save(11, 'A');
    const s = run([{ type: 'newCareer', saves: [target] }, { type: 'show', view: { kind: 'rename', save: target } }]);
    expect(s.panel).toEqual({ kind: 'slots', view: { kind: 'rename', save: target } });
    const back = run([{ type: 'refreshed', saves: [target], view: { kind: 'list', purpose: 'play' } }], { ...s, notice: '古い知らせ' });
    expect(back.notice).toBe('');
    expect(back.panel).toEqual({ kind: 'slots', view: { kind: 'list', purpose: 'play' } });
  });

  it('複製の失敗は一覧を読み直して知らせを出し、画面は変えない', () => {
    const base = run([{ type: 'continueCareer', saves: CAREER_FULL, noneMessage: '' }]);
    const s = run([{ type: 'listed', saves: CAREER_FULL }, { type: 'notice', notice: '空きがない' }], base);
    expect(s.notice).toBe('空きがない');
    expect(s.panel).toEqual(base.panel);
  });

  it('読み込んだ会社を枠に入れたら、読み込み中の会社を捨てて一覧（続けて遊ぶ）に戻る', () => {
    const held = run([{ type: 'importHeld', data: { name: 'X' } as unknown as World, saves: CAREER_FULL, notice: '満杯' }]);
    const done = run([{ type: 'importDone', saves: CAREER_FULL }], held);
    expect(done.pendingImport).toBeNull();
    expect(done.notice).toBe('');
    expect(done.panel).toEqual({ kind: 'slots', view: { kind: 'list', purpose: 'play' } });
  });

  it('一覧の「新しく作る」でサンドボックスの広さを選び、閉じるとメニューに戻る', () => {
    const s = run([{ type: 'sandbox', saves: [save(21, 'A')] }, { type: 'openSandboxSize' }]);
    expect(s.panel).toEqual({ kind: 'sandboxSize' });
    expect(run([{ type: 'closeSandboxSize' }], s).panel).toEqual({ kind: 'menu' });
  });
});
