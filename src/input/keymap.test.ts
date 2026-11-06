import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bindMapCommands, PAN_KEY_PX } from '../game/mapControl';
import { KEYMAP, handleKey, keyName, keyOfAction, tipText, type KeyInput, type UiActions } from './keymap';

const LANG = JSON.parse(readFileSync(`${process.cwd()}/src/assets/lang/ja_jp.json`, 'utf-8')) as Record<string, string>;

const input = (key: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

const fakeUi = () => {
  const calls: string[] = [];
  const ui: UiActions = {
    togglePopup: (name) => calls.push(`popup:${name}`),
    toggleInventory: () => calls.push('inventory'),
  };
  return { ui, calls };
};

const target = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, isContentEditable: false, ...extra }) as unknown as EventTarget;

describe('keyName（キーの入力を表の書き方にする）', () => {
  it('英字は大文字にし、記号と数字はそのまま使う', () => {
    expect(keyName(input('t'))).toBe('T');
    expect(keyName(input('?'))).toBe('?');
    expect(keyName(input('['))).toBe('[');
    expect(keyName(input('1'))).toBe('1');
  });

  it('Esc・Space・矢印は表の名前にする', () => {
    expect(keyName(input('Escape'))).toBe('Esc');
    expect(keyName(input(' '))).toBe('Space');
    expect(keyName(input('ArrowLeft'))).toBe('←');
  });

  it('Ctrl と Shift+Tab は前に付ける', () => {
    expect(keyName(input('z', { ctrlKey: true }))).toBe('Ctrl+Z');
    expect(keyName(input('y', { metaKey: true }))).toBe('Ctrl+Y');
    expect(keyName(input('Tab', { shiftKey: true }))).toBe('Shift+Tab');
  });
});

describe('KEYMAP（CORE.md「キー操作」の表）', () => {
  it('CORE.md の表のキーをすべて持つ', () => {
    const keys = KEYMAP.map((b) => b.key);
    for (const k of ['1', '2', '3', 'Esc', 'Enter', 'Tab', 'Shift+Tab', 'Delete', 'Ctrl+Z', 'Ctrl+Y', 'Space', '[', ']', 'T', 'B', 'I', 'M', 'S', 'E', 'H', '+', '-', '0', '↑', '↓', '←', '→', '?']) {
      expect(keys, k).toContain(k);
    }
  });

  it('同じキーを2つの行に書かない', () => {
    const keys = KEYMAP.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('動作の名前は、すべて言語ファイルにある', () => {
    for (const b of KEYMAP) {
      expect(LANG[b.name], b.name).toBeTruthy();
    }
  });

  it('ツールチップ用のキーは、動作の識別子から引ける', () => {
    expect(keyOfAction('tool.wire')).toBe('2');
    expect(keyOfAction('test')).toBe('T');
    expect(keyOfAction('no-such-action')).toBeUndefined();
  });

  it('ツールチップの2行目にキーを出す（キーがなければ名前だけ）', () => {
    // このテストでは言語を読み込まないため、文言は文言キーのまま出る（キーの値は表から入る）
    expect(tipText('ui.tool.wire', 'tool.wire')).toBe('ui.tool.wire\nui.tip.key');
    expect(tipText('ui.tool.wire', 'none')).toBe('ui.tool.wire');
    // スマホ（withKey が false）では、キーの行を出さない（B4）
    expect(tipText('ui.tool.wire', 'tool.wire', false)).toBe('ui.tool.wire');
  });
});

describe('handleKey（キーの処理）', () => {
  it('ポップアップのキーは UI の操作を呼ぶ', () => {
    const { ui, calls } = fakeUi();
    expect(handleKey({ ...input('?'), target: null }, ui)).toBe(true);
    expect(handleKey({ ...input('m'), target: null }, ui)).toBe(true);
    expect(handleKey({ ...input('E'), target: null }, ui)).toBe(true);
    expect(calls).toEqual(['popup:help', 'popup:offers', 'inventory']);
  });

  it('入力欄にいるときは Enter・Esc・Tab 以外を無視する', () => {
    const { ui, calls } = fakeUi();
    expect(handleKey({ ...input('m'), target: target('INPUT') }, ui)).toBe(false);
    expect(handleKey({ ...input('?'), target: target('TEXTAREA') }, ui)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('動作がない行（Tab など）は処理しない（既定の動作に任せる）', () => {
    const { ui } = fakeUi();
    expect(handleKey({ ...input('Tab'), target: null }, ui)).toBe(false);
  });

  it('+ - 0 と矢印キーは、マップの命令を呼ぶ（Ctrl と組み合わせても同じ）', () => {
    const { ui } = fakeUi();
    const calls: string[] = [];
    bindMapCommands({
      zoomIn: () => calls.push('in'),
      zoomOut: () => calls.push('out'),
      fit: () => calls.push('fit'),
      pan: (dx, dy) => calls.push(`pan:${dx},${dy}`),
    });
    try {
      expect(handleKey({ ...input('+'), target: null }, ui)).toBe(true);
      expect(handleKey({ ...input('-'), target: null }, ui)).toBe(true);
      expect(handleKey({ ...input('0'), target: null }, ui)).toBe(true);
      expect(handleKey({ ...input('='), target: null }, ui)).toBe(true);
      expect(handleKey({ ...input('-', { ctrlKey: true }), target: null }, ui)).toBe(true);
      expect(handleKey({ ...input('0', { ctrlKey: true }), target: null }, ui)).toBe(true);
      expect(handleKey({ ...input('ArrowLeft'), target: null }, ui)).toBe(true);
      expect(calls).toEqual(['in', 'out', 'fit', 'in', 'out', 'fit', `pan:${PAN_KEY_PX},0`]);
    } finally {
      bindMapCommands(null);
    }
  });

  it('入力欄では Ctrl+- などを奪わない', () => {
    const { ui } = fakeUi();
    expect(handleKey({ ...input('-', { ctrlKey: true }), target: target('INPUT') }, ui)).toBe(false);
  });

  it('Alt を伴うキーは無視する', () => {
    const { ui, calls } = fakeUi();
    expect(handleKey({ ...input('?', { altKey: true }), target: null }, ui)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('ボタンの上の Enter は、ボタンのクリックに任せる', () => {
    const { ui } = fakeUi();
    expect(handleKey({ ...input('Enter'), target: target('BUTTON') }, ui)).toBe(false);
  });
});
