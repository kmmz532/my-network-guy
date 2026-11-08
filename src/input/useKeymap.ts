// キーの表（keymap.ts）を画面に結びつける。ゲームの場面の間だけ使う
import { useEffect } from 'react';
import { handleKey } from './keymap';

export function useKeymap(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (handleKey(e)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
