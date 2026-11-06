import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { useGameStore } from './stores/useGameStore';
import { watchUpdates } from './pwa/update';

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

// オフラインでも起動できるよう、本番のビルドだけサービスワーカーを登録する。
// 新しい版は待機させ、利用者が更新を押したあとだけ切り替えて再読み込みする（もともと版がなかったときの最初の読み込みでは再読み込みしない）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const hadController = navigator.serviceWorker.controller !== null;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((reg) => watchUpdates(reg))
      .catch(() => undefined);
  });
}
