// キーの表（keymap.ts）を画面に結びつける。ゲームの画面が開いている間だけ効く
import { useEffect, useRef } from 'react';
import { handleKey, type UiActions } from './keymap';

export function useKeymap(enabled: boolean, ui: UiActions): void {
  const latest = useRef(ui);
  useEffect(() => {
    latest.current = ui;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (handleKey(e, latest.current)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
