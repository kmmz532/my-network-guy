import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { useGameStore } from './stores/useGameStore';

// 開発中と撮影用のビルド（VITE_SHOOT）だけ、画面の確認の自動化から状態を操作できるようにする（通常の本番のビルドには含めない）
if (import.meta.env.DEV || import.meta.env.VITE_SHOOT) (window as unknown as { __game: typeof useGameStore }).__game = useGameStore;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// iOS Safari はピンチをページの拡大にするため、ここで止める（マップの拡大・縮小は Scene が行う）
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
