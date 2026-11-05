// 倉庫の欄。ツールバーの上に横スクロールで在庫の品目を並べる。品目を押すと配置の操作に入る。
// 品目をマウス・ペンでドラッグしてマップの上で離すと、そのマスに置く（置けなければ何もしない）
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { devices } from 'virtual:game-data';
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import type { WarehouseItem } from '../sim/warehouse';
import { mapViewOf } from '../game/mapView';
import { useGameStore } from '../stores/useGameStore';
import { isDragMove } from './rearDrag';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';
import { RADIUS } from '../ui/theme';

const strip = {
  position: 'absolute',
  left: 12,
  right: 12,
  bottom: 72,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: 6,
  overflowX: 'auto',
  background: 'rgba(47, 79, 143, 0.95)',
  color: '#f4f1e6',
  border: '2px solid #3b2a33',
  borderRadius: RADIUS.chrome,
  zoom: 'var(--ui-scale, 1)',
} as const;

const itemStyle = (active: boolean) =>
  ({
    flex: '0 0 auto',
    width: 52,
    height: 52,
    padding: 2,
    border: `2px solid ${active ? '#ffd866' : '#3b2a33'}`,
    background: active ? '#3a5fa8' : '#25406f',
    borderRadius: RADIUS.none,
    touchAction: 'pan-x',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#f4f1e6',
    position: 'relative',
  }) as const;

const spriteOf = (item: WarehouseItem): string =>
  item.kind === 'device' ? devices[item.id as keyof typeof devices].sprite : `furniture/${item.id}`;

export function Warehouse({
  items,
  owned,
  placing,
  onPick,
  onShop,
}: {
  items: WarehouseItem[];
  owned: Record<string, number>;
  placing: string | null;
  onPick: (item: WarehouseItem) => void;
  onShop: () => void;
}) {
  const itemDrag = useGameStore((s) => s.itemDrag);
  const setItemDrag = useGameStore((s) => s.setItemDrag);
  // ドラッグを終えたあとに続く click を1回無視する
  const ignoreClick = useRef(false);
  // 進行中のドラッグを止める（Esc・別の品目を押したとき・画面を閉じたとき）
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);

  const suppressClick = () => {
    ignoreClick.current = true;
    window.setTimeout(() => {
      ignoreClick.current = false;
    }, 0);
  };

  // マップの上で離したとき、キャンバスの上で、そのマスに置けるなら置く
  const dropAt = (id: string, x: number, y: number) => {
    const view = mapViewOf();
    if (!view || !(document.elementFromPoint(x, y) instanceof HTMLCanvasElement)) return;
    const tile = view.tileAtClient(x, y);
    if (!tile || !view.canPlace(id, tile.tx, tile.ty)) return;
    useGameStore.getState().place(id, tile.tx, tile.ty);
  };

  // 押した品目を、動かしたらドラッグとして扱う。動かさずに離したときは click（押して配置）に任せる。
  // 指の操作は欄のスクロールに使うため、ドラッグはマウスとペンだけにする
  const onItemPointerDown = (item: WarehouseItem) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const touch = e.pointerType === 'touch';
    stopRef.current?.();
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;

    const stop = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      stopRef.current = null;
      setItemDrag(null);
    };
    const onMove = (ev: globalThis.PointerEvent) => {
      if (!moved) {
        if (!isDragMove(startX, startY, ev.clientX, ev.clientY)) return;
        // 指では、横に動かしたら欄のスクロール、上に引き出したらドラッグとして扱う
        if (touch && Math.abs(ev.clientX - startX) > Math.abs(ev.clientY - startY)) {
          stop();
          return;
        }
        moved = true;
      }
      setItemDrag({ id: item.id, x: ev.clientX, y: ev.clientY });
    };
    const onUp = (ev: globalThis.PointerEvent) => {
      const dragged = moved;
      stop();
      if (!dragged) return;
      suppressClick();
      dropAt(item.id, ev.clientX, ev.clientY);
    };
    const onCancel = () => {
      const dragged = moved;
      stop();
      if (dragged) suppressClick();
    };
    // ドラッグの途中の Esc は、ドラッグだけを取り消す（ほかの Esc の処理には渡さない）
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const dragged = moved;
      stop();
      if (dragged) suppressClick();
    };
    stopRef.current = stop;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
  };

  if (items.length === 0) {
    return (
      <div style={{ ...strip, justifyContent: 'center', overflowX: 'visible' }}>
        <span>{t('ui.warehouse.empty')}</span>
        <button style={{ padding: '4px 12px', cursor: 'pointer' }} onClick={onShop}>
          {t('ui.warehouse.openShop')}
        </button>
      </div>
    );
  }
  const dragged = itemDrag ? items.find((item) => item.id === itemDrag.id) : undefined;
  return (
    <>
      <div style={strip}>
        {items.map((item) => {
          const key = `${item.kind}-${item.id}`;
          const name =
            item.kind === 'device' ? t(`device.${item.id}.name` as LangKey) : t(`furniture.${item.id}.name` as LangKey);
          return (
            <Tooltip text={name} key={key}>
              <button
                aria-label={name}
                style={itemStyle(placing === item.id)}
                onPointerDown={onItemPointerDown(item)}
                onClick={() => {
                  if (!ignoreClick.current) onPick(item);
                }}
              >
                <Icon name={spriteOf(item)} scale={1} />
                <span style={{ position: 'absolute', right: 2, bottom: 0, fontSize: 11, fontWeight: 'bold', textShadow: '0 0 2px #3b2a33' }}>
                  {owned[item.id] ?? 0}
                </span>
              </button>
            </Tooltip>
          );
        })}
      </div>
      {itemDrag && dragged && (
        // ドラッグ中の品目の絵。ポインターに付いて動く（マップの判定には使わない）
        <div style={{ position: 'fixed', left: itemDrag.x - 16, top: itemDrag.y - 16, pointerEvents: 'none', opacity: 0.85, zIndex: 1000 }}>
          <Icon name={spriteOf(dragged)} scale={1} />
        </div>
      )}
    </>
  );
}
