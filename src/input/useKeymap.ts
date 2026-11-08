// キーの表（keymap.ts）を画面に結びつける。ゲームの画面が開いている間だけ効く
import { useEffect } from 'react';
import { handleKey } from './keymap';

export function useKeymap(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (handleKey(e)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
