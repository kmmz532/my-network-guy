import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { bindMapCommands, PAN_KEY_PX } from '../game/mapControl';
import { useGameStore } from '../stores/useGameStore';
import { useUiStore } from '../stores/useUiStore';
import { KEYMAP, handleKey, keyName, keyOfAction, tipText, type KeyInput } from './keymap';

const LANG = JSON.parse(readFileSync(`${process.cwd()}/src/assets/lang/ja_jp.json`, 'utf-8')) as Record<string, string>;

const input = (key: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

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

const inventoryCalls = vi.hoisted(() => [] as string[]);
vi.mock('../ui/inventoryOpen', () => ({ toggleInventory: () => inventoryCalls.push('inventory') }));

describe('handleKey（キーの処理）', () => {
  it('ポップアップのキーは画面の開け閉めを呼ぶ', () => {
    inventoryCalls.length = 0;
    useUiStore.setState({ popup: null });
    const windowCalls: string[] = [];
    useGameStore.setState({ toggleWindow: (kind) => windowCalls.push(kind) });
    expect(handleKey({ ...input('?'), target: null })).toBe(true);
    expect(useUiStore.getState().popup).toBe('help');
    expect(handleKey({ ...input('m'), target: null })).toBe(true);
    expect(windowCalls).toEqual(['offers']);
    expect(handleKey({ ...input('E'), target: null })).toBe(true);
    expect(inventoryCalls).toEqual(['inventory']);
  });

  it('入力欄にいるときは Enter・Esc・Tab 以外を無視する', () => {
    useUiStore.setState({ popup: null });
    expect(handleKey({ ...input('m'), target: target('INPUT') })).toBe(false);
    expect(handleKey({ ...input('?'), target: target('TEXTAREA') })).toBe(false);
    expect(useUiStore.getState().popup).toBeNull();
  });

  it('動作がない行（Tab など）は処理しない（既定の動作に任せる）', () => {
    expect(handleKey({ ...input('Tab'), target: null })).toBe(false);
  });

  it('+ - 0 と矢印キーは、マップの命令を呼ぶ（Ctrl と組み合わせても同じ）', () => {
    const calls: string[] = [];
    bindMapCommands({
      zoomIn: () => calls.push('in'),
      zoomOut: () => calls.push('out'),
      fit: () => calls.push('fit'),
      pan: (dx, dy) => calls.push(`pan:${dx},${dy}`),
    });
    try {
      expect(handleKey({ ...input('+'), target: null })).toBe(true);
      expect(handleKey({ ...input('-'), target: null })).toBe(true);
      expect(handleKey({ ...input('0'), target: null })).toBe(true);
      expect(handleKey({ ...input('='), target: null })).toBe(true);
      expect(handleKey({ ...input('-', { ctrlKey: true }), target: null })).toBe(true);
      expect(handleKey({ ...input('0', { ctrlKey: true }), target: null })).toBe(true);
      expect(handleKey({ ...input('ArrowLeft'), target: null })).toBe(true);
      expect(calls).toEqual(['in', 'out', 'fit', 'in', 'out', 'fit', `pan:${PAN_KEY_PX},0`]);
    } finally {
      bindMapCommands(null);
    }
  });

  it('入力欄では Ctrl+- などを奪わない', () => {
    expect(handleKey({ ...input('-', { ctrlKey: true }), target: target('INPUT') })).toBe(false);
  });

  it('Alt を伴うキーは無視する', () => {
    useUiStore.setState({ popup: null });
    expect(handleKey({ ...input('?', { altKey: true }), target: null })).toBe(false);
    expect(useUiStore.getState().popup).toBeNull();
  });

  it('ボタンの上の Enter は、ボタンのクリックに任せる', () => {
    expect(handleKey({ ...input('Enter'), target: target('BUTTON') })).toBe(false);
  });
});

describe('Space（一時停止と再開）', () => {
  it('停止から戻るときは、止める前の速さに戻す。速さはゲームの状態が覚える', () => {
    useGameStore.setState({ speed: 1, resumeSpeed: 1, mode: 'career' });
    useGameStore.getState().setSpeed(2);
    expect(useGameStore.getState().resumeSpeed).toBe(2);
    expect(handleKey({ ...input(' '), target: null })).toBe(true);
    expect(useGameStore.getState().speed).toBe(0);
    expect(useGameStore.getState().resumeSpeed).toBe(2);
    expect(handleKey({ ...input(' '), target: null })).toBe(true);
    expect(useGameStore.getState().speed).toBe(2);
  });

  it('停止（0）に変えても、戻る速さは変えない', () => {
    useGameStore.setState({ speed: 2, resumeSpeed: 2, mode: 'career' });
    useGameStore.getState().setSpeed(0);
    expect(useGameStore.getState().resumeSpeed).toBe(2);
  });
});
