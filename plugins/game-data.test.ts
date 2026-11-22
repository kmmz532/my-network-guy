// 外部へ届くかを見る達成条件の案件は、回線終端（uplink）を置いていなければ、データの読み込みで止まる
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadData } from './game-data';

const root = resolve(import.meta.dirname, '..');
const langDir = join(root, 'resources/lang');
const spriteDir = join(root, 'resources/sprites');
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('外部へ届くかを見る案件', () => {
  it('回線終端（uplink）を置いていなければ、読み込みで止まる', () => {
    const dir = mkdtempSync(join(tmpdir(), 'game-data-'));
    tempDirs.push(dir);
    const dataDir = join(dir, 'data');
    cpSync(join(root, 'resources/data'), dataDir, { recursive: true });
    // n001（社内の PC を外へ届かせる）から回線終端だけを外す
    const file = join(dataDir, 'contracts', 'n001_napt_office.json');
    const contract = JSON.parse(readFileSync(file, 'utf8'));
    contract.placed = contract.placed.filter((p: { device: string }) => p.device !== 'uplink');
    writeFileSync(file, JSON.stringify(contract));
    expect(() => loadData(dataDir, langDir, spriteDir)).toThrow(/回線終端（uplink）が placed にない/);
  });
});
