// 略記の展開。語が一意に決まるときだけ正式な形にし、決まらなければ展開しない
import { describe, expect, it } from 'vitest';
import { expandAbbrev } from './terminal';

describe('略記の展開', () => {
  it('一意に決まる略記は、正式な形に直す', () => {
    expect(expandAbbrev('sh ip ro')).toEqual({ ok: true, line: 'show ip route' });
  });

  it('一意に決まらない略記は、展開せず ambiguous を返す', () => {
    expect(expandAbbrev('sh i')).toEqual({ ok: false, reason: 'ambiguous' });
  });

  it('表にない語（機器の名前など）は、そのまま残す', () => {
    expect(expandAbbrev('ping R1')).toEqual({ ok: true, line: 'ping R1' });
  });
});
