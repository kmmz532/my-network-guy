import { useEffect, useRef } from 'react';
import { Application, Graphics } from 'pixi.js';

// Pixi.js のキャンバスをReactに組み込む。描画はこのコンポーネント内のみで行い、UIはReactのDOM層で描く。
export function PixiStage() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let app: Application | null = null;
    let disposed = false;

    // StrictModeでは開発時にエフェクトが2回走るため、初期化後に破棄済みなら即座に破棄する
    const init = async () => {
      const instance = new Application();
      await instance.init({
        resizeTo: host,
        background: '#2f4f8f',
        antialias: false,
        roundPixels: true,
      });
      if (disposed) {
        instance.destroy(true, { children: true });
        return;
      }
      app = instance;
      host.appendChild(instance.canvas);
      const probe = new Graphics().rect(16, 16, 64, 64).fill('#ffd866');
      instance.stage.addChild(probe);
    };
    void init();

    return () => {
      disposed = true;
      app?.destroy(true, { children: true });
      app = null;
    };
  }, []);

  return <div ref={hostRef} style={{ width: '100%', height: '100%' }} />;
}
