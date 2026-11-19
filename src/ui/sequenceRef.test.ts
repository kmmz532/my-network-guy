import { describe, expect, it } from 'vitest';
import { parseRef, sequenceRef, sequenceRefOf } from './sequenceRef';

describe('シーケンス図の窓の ref', () => {
  it('名前で引いた HTTP は、名前を5つ目の欄に持ち、解釈すると同じ指定に戻る', () => {
    const trigger = { kind: 'http' as const, from: 'PC1', to: 'WEB', port: 80, name: 'web.office.internal' };
    expect(sequenceRefOf(trigger)).toBe('http|PC1|WEB|80|web.office.internal');
    expect(parseRef(sequenceRefOf(trigger))).toEqual(trigger);
  });

  it('名前のない HTTP は、従来の4つの欄のままで、名前を持たない', () => {
    expect(sequenceRefOf({ kind: 'http', from: 'PC1', to: 'WEB', port: 80 })).toBe('http|PC1|WEB|80');
    expect(parseRef('http|PC1|WEB|80')).toEqual({ kind: 'http', from: 'PC1', to: 'WEB', port: 80 });
  });

  it('テストの結果の行は、名前で引いた通信の名前を渡す', () => {
    expect(sequenceRef({ kind: 'http', src: 'PC1', dst: 'WEB', name: 'web.office.internal' })).toBe('http|PC1|WEB|80|web.office.internal');
    expect(sequenceRef({ kind: 'http', src: 'PC1', dst: 'WEB' })).toBe('http|PC1|WEB|80');
  });
});
