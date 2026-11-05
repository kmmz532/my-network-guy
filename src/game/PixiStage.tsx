import { useEffect, useRef } from 'react';
import { Application } from 'pixi.js';
import { Scene } from './Scene';
import { loadTextures } from './sprites';
import { MapZoomButtons } from './MapZoomButtons';

// Pixi.js のキャンバスをReactに組み込む。描画と操作は Scene が行い、UIはReactのDOM層で描く。
export function PixiStage() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let app: Application | null = null;
    let scene: Scene | null = null;
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
      await loadTextures();
      if (disposed) {
        instance.destroy(true, { children: true });
        return;
      }
      app = instance;
      host.appendChild(instance.canvas);
      scene = new Scene(instance);
    };
    void init();

    return () => {
      disposed = true;
      scene?.destroy();
      scene = null;
      app?.destroy(true, { children: true });
      app = null;
    };
  }, []);

  // 拡大・縮小のボタンは、マップの上に重ねる（キャンバスの外の部品として置く）
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
      <MapZoomButtons />
    </div>
  );
}
