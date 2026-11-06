import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ErrorScreen } from './components/ErrorScreen';
import { useGameStore } from './stores/useGameStore';
import { isApplyingUpdate, watchUpdates } from './pwa/update';

// 開発中と撮影用のビルド（VITE_SHOOT）だけ、画面の確認の自動化から状態を操作できるようにする（通常の本番のビルドには含めない）
if (import.meta.env.DEV || import.meta.env.VITE_SHOOT) (window as unknown as { __game: typeof useGameStore }).__game = useGameStore;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorScreen>
      <App />
    </ErrorScreen>
  </React.StrictMode>,
);

// iOS Safari はマップの上のピンチをページの拡大にするため、マップ（canvas）の上だけ止める（マップの拡大・縮小は Scene が行う）。
// 文字の拡大（ページの拡大）は、それ以外の場所で使えるようにする
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(
    type,
    (e) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('canvas')) e.preventDefault();
    },
    { passive: false },
  );
}

// オフラインでも起動できるよう、本番のビルドだけサービスワーカーを登録する。
// 新しい版は待機させ、利用者が更新を押したあとだけ切り替えて再読み込みする（もともと版がなかったときの最初の読み込みでは再読み込みしない）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const hadController = navigator.serviceWorker.controller !== null;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // 利用者が「更新する」を押したときだけ読み込み直す（プレイ中に勝手に切り替えて読み込み直さない）
    if (hadController && isApplyingUpdate()) window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((reg) => watchUpdates(reg))
      .catch(() => undefined);
  });
}
