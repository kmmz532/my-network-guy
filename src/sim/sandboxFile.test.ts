// サンドボックスの構成の書き出しと読み込み。書いたものを読むと元と同じになり、合わないファイルは理由を返す
import { describe, expect, it } from 'vitest';
import { readSandboxFile, writeSandboxFile } from './sandboxFile';
import { sandboxOffice } from './sandbox';

describe('サンドボックスの構成のファイル', () => {
  it('書き出したものを読むと、元と同じ構成になる', () => {
    const office = sandboxOffice();
    const result = readSandboxFile(writeSandboxFile(office));
    expect(result).toEqual({ ok: true, office });
  });

  it('JSON として読めないファイルは、json の理由を返す', () => {
    expect(readSandboxFile('{not json')).toEqual({ ok: false, reason: 'json' });
  });

  it('形式の名前が違うファイルは、format の理由を返す', () => {
    const other = JSON.stringify({ format: 'other', version: 1, office: sandboxOffice() });
    expect(readSandboxFile(other)).toEqual({ ok: false, reason: 'format' });
  });

  it('版が違うファイルは、version の理由を返す', () => {
    const newer = JSON.stringify({ format: 'network-ya.sandbox', version: 2, office: sandboxOffice() });
    expect(readSandboxFile(newer)).toEqual({ ok: false, reason: 'version' });
  });

  it('中身の形が合わないファイルは、読み込まずに shape の理由を返す', () => {
    const office = { ...sandboxOffice(), nodes: [{ device: 'pc_basic', x: 1, y: 1 }] };
    const broken = JSON.stringify({ format: 'network-ya.sandbox', version: 1, office });
    expect(readSandboxFile(broken)).toEqual({ ok: false, reason: 'shape' });
  });
});
