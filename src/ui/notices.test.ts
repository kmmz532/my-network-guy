// 画面の通知の列（N96）: 積む・3件まで・まとめ・期限・押して閉じる・表にない種類
import { describe, expect, it } from 'vitest';
import { NOTICE_MS, dismissNotice, openOf, promoteNotices, pushNotice, visibleNotices } from './notices';

describe('通知の列（N96）', () => {
  it('3件までは同時に出て、4件目は前が消えるまで待つ', () => {
    let list = pushNotice([], 'salary', { amount: 1 }, 0);
    list = pushNotice(list, 'delegated', { money: 1 }, 0);
    list = pushNotice(list, 'hired', { name: 'a' }, 0);
    list = pushNotice(list, 'trained', { name: 'b' }, 0);
    expect(visibleNotices(list)).toHaveLength(3);
    expect(list[3].shownAt).toBeNull();
  });

  it('古いものから期限（3秒）で消え、待っていたものが出る', () => {
    let list = pushNotice([], 'salary', {}, 0);
    list = pushNotice(list, 'hired', {}, 0);
    list = pushNotice(list, 'trained', {}, 0);
    list = pushNotice(list, 'retired', {}, 0);
    const later = promoteNotices(list, NOTICE_MS);
    expect(visibleNotices(later)).toHaveLength(1);
    expect(later[0].shownAt).toBe(NOTICE_MS);
  });

  it('同じ種類がまとめられるものは、1件にまとめて件数を数える', () => {
    let list = pushNotice([], 'salesArrival', { count: 1 }, 0);
    list = pushNotice(list, 'salary', {}, 0);
    list = pushNotice(list, 'salesArrival', { count: 2 }, 100);
    expect(list.filter((n) => n.kind === 'salesArrival')).toHaveLength(1);
    expect(list.find((n) => n.kind === 'salesArrival')).toMatchObject({ count: 2, params: { count: 2 } });
  });

  it('押して閉じる通知（給与を払えない月）は、期限では消えない', () => {
    let list = pushNotice([], 'payPause', {}, 0);
    list = promoteNotices(list, NOTICE_MS * 10);
    expect(list).toHaveLength(1);
    expect(dismissNotice(list, list[0].id)).toHaveLength(0);
  });

  it('押したときに開く画面を表で決める（給与は資金、依頼は依頼の一覧）', () => {
    expect(openOf('salary')).toBe('funds');
    expect(openOf('delegated')).toBe('offers');
  });

  it('表にない種類を出そうとしたら例外にする（R5）', () => {
    expect(() => pushNotice([], 'unknown' as never, {}, 0)).toThrow();
  });
});
