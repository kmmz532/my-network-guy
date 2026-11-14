import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (name: string): string => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

describe('トークン', () => {
  const defined = new Set([...read('tokens.css').matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

  it('ui.css が使う変数は、すべて tokens.css にある', () => {
    const used = [...read('ui.css').matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((v) => !defined.has(v))).toEqual([]);
  });

  it('tokens.ts が指す変数は、すべて tokens.css にある', () => {
    const used = [...read('tokens.ts').matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]);
    expect(used.filter((v) => !defined.has(v))).toEqual([]);
  });
});
