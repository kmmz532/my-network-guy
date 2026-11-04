import { useEffect, useRef } from 'react';
import { Application } from 'pixi.js';
import { mapLoaders } from 'virtual:loaders';
import type { MapId } from '../generated/ids';
import { drawTileMap, layoutIntegerScale } from './TileMap';

interface Props {
  mapId: MapId;
}

// Pixi.js のキャンバスをReactに組み込む。描画はこの層だけで行い、UIはReactのDOM層で描く。
export function PixiStage({ mapId }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let app: Application | null = null;
    let disposed = false;
    let onResize: (() => void) | null = null;

    // StrictModeでは開発時にエフェクトが2回走るため、初期化後に破棄済みなら即座に破棄する
    const init = async () => {
      const [instance, { default: map }] = await Promise.all([
        (async () => {
          const created = new Application();
          await created.init({
            resizeTo: host,
            background: '#2f4f8f',
            antialias: false,
            roundPixels: true,
          });
          return created;
        })(),
        mapLoaders[mapId](),
      ]);
      if (disposed) {
        instance.destroy(true, { children: true });
        return;
      }
      app = instance;
      host.appendChild(instance.canvas);

      const content = drawTileMap(map);
      instance.stage.addChild(content);
      const layout = () => layoutIntegerScale(content, map, instance.screen.width, instance.screen.height);
      layout();
      onResize = layout;
      window.addEventListener('resize', layout);
    };
    void init();

    return () => {
      disposed = true;
      if (onResize) window.removeEventListener('resize', onResize);
      app?.destroy(true, { children: true });
      app = null;
    };
  }, [mapId]);

  return <div ref={hostRef} style={{ width: '100%', height: '100%' }} />;
}
