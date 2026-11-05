import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { useGameStore } from './stores/useGameStore';

// 開発中だけ、画面の確認の自動化から状態を操作できるようにする（本番のビルドには含めない）
if (import.meta.env.DEV) (window as unknown as { __game: typeof useGameStore }).__game = useGameStore;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
