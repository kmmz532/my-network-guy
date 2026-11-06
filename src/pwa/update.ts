// 新しい版（待機中のサービスワーカー）の通知と、利用者の操作による更新。勝手には切り替えない
export type UpdateListener = (ready: boolean) => void;

let waiting: ServiceWorkerRegistration | null = null;
const listeners = new Set<UpdateListener>();

const emit = (ready: boolean) => listeners.forEach((l) => l(ready));

// 通知を受け取る。戻り値の関数で解除する
export const subscribeUpdate = (listener: UpdateListener): (() => void) => {
  listeners.add(listener);
  listener(waiting !== null);
  return () => {
    listeners.delete(listener);
  };
};

// 登録したサービスワーカーの更新を見る。新しい版が待機に入ったら通知する（初回の導入では通知しない）
export const watchUpdates = (reg: ServiceWorkerRegistration): void => {
  const hasController = (): boolean => navigator.serviceWorker.controller !== null;
  const check = (): void => {
    if (reg.waiting && hasController()) {
      waiting = reg;
      emit(true);
    }
  };
  check();
  reg.addEventListener('updatefound', () => {
    const next = reg.installing;
    next?.addEventListener('statechange', () => {
      if (next.state === 'installed') check();
    });
  });
};

// 利用者が「更新する」を押したあとだけ、切り替えによる再読み込みを行う（プレイ中に勝手に読み込み直さない）
let applying = false;
export const isApplyingUpdate = (): boolean => applying;

// 利用者が「更新する」を押したとき。待機中の版を有効にする（controllerchange で再読み込みする）
export const applyUpdate = (): void => {
  applying = true;
  waiting?.waiting?.postMessage({ type: 'SKIP_WAITING' });
  waiting = null;
  emit(false);
};
