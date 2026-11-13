// インベントリ。スマホはツールバーの上に横スクロールの帯（strip）、パソコンはウィンドウの中の格子（grid。InventoryBody）で在庫の品目を並べる。
// 品目を押すと配置の操作に入る。品目をマウス・ペンでドラッグしてマップの上で離すと、そのマスに置く（置けなければ何もしない）
import { trackDrag } from '../input/trackDrag';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { shop as catalogShop } from 'virtual:game-data';
import { t, tDyn } from '../i18n/t';
import { focusedProject } from '../stores/useGameStore';
import { inventoryItems, inventoryMode, type InventoryItem } from '../sim/inventory';
import { Tabs, TAB_COLORS, tabPanelStyle } from './Tabs';
import { mapViewOf } from '../game/mapView';
import { useGameStore } from '../stores/useGameStore';
import { Icon } from './Icon';
import { ItemIcon } from './ItemIcon';
import { Tooltip } from './Tooltip';
import { secondaryButton } from './Modal';
import { RADIUS } from '../ui/theme';
import { matchesQuery } from '../ui/search';
import { SearchField } from './SearchField';
import { itemSpriteOf } from './itemSprite';
import { deviceDef, devicesById, furnitureById } from '../registry/query';

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
  zoom: 'var(--ui-scale, 1)',
} as const;

const itemStyle = (active: boolean) =>
  ({
    flex: '0 0 auto',
    width: 52,
    height: 52,
    padding: 2,
    border: `1px solid ${active ? '#ffd866' : '#3b2a33'}`,
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

// パソコンのウィンドウの中の並び。幅に合わせて折り返す（縦のスクロールはウィンドウが受け持つ）
const grid = {
  display: 'flex',
  flexWrap: 'wrap',
  alignContent: 'flex-start',
  gap: 4,
  color: '#f4f1e6',
  marginTop: 4,
} as const;

const spriteOf = (item: InventoryItem): string => itemSpriteOf(item.kind, item.id);

// 並べ方を決める定義（機材・家具・店の並び順）
export const inventoryCatalog = {
  devices: devicesById,
  furniture: furnitureById,
  shopOrder: catalogShop.map((i) => ('device' in i && i.device ? i.device : 'furniture' in i && i.furniture ? i.furniture : '')).filter((id) => id !== ''),
};

type InventoryTab = 'all' | 'device' | 'furniture';
const INVENTORY_TABS: readonly InventoryTab[] = ['all', 'device', 'furniture'];

// 検索の対象（名前・ID・機器の分類）
const itemSearchFields = (item: InventoryItem): string[] =>
  item.kind === 'device'
    ? [tDyn(`device.${item.id}.name`), tDyn(`device.${item.id}.kana`), item.id, tDyn(`category.${deviceDef(item.id).category}`)]
    : [tDyn(`furniture.${item.id}.name`), tDyn(`furniture.${item.id}.kana`), item.id];

// パソコンのインベントリのウィンドウの中身。上にショップと同じタブ（先頭は「すべて」）、下に品目の格子
export function InventoryBody() {
  const owned = useGameStore((s) => s.owned);
  const placing = useGameStore((s) => s.placing);
  const phase = useGameStore((s) => focusedProject(s)?.phase ?? null);
  const showcase = useGameStore((s) => s.showcase !== null);
  // 選んだタブは、開いている間だけ覚える（保存しない）
  const [tab, setTab] = useState<InventoryTab>('all');
  // 検索は選んでいるタブの中で絞り込む。「すべて」は全分類から探す（N67）
  const [query, setQuery] = useState('');
  const sandbox = useGameStore((s) => s.mode) === 'sandbox';
  const all = inventoryItems(inventoryMode(phase, showcase), owned, inventoryCatalog, sandbox);
  const inTab = tab === 'all' ? all : all.filter((item) => item.kind === tab);
  const items = inTab.filter((item) => matchesQuery(query, itemSearchFields(item)));
  // 品目を押すと配置に入る。同じ品目をもう一度押すと配置を終える（ウィンドウは開いたまま）
  const pick = (item: InventoryItem) => {
    const s = useGameStore.getState();
    s.setTool('select');
    s.setPlacing(s.placing === item.id ? null : item.id);
  };
  return (
    // ウィンドウの高さいっぱいに枠を伸ばし、品目は幅に合わせて複数行に並べる
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <Tabs
        idPrefix="inventory-tab"
        ariaLabel={t('ui.inventory.title')}
        items={INVENTORY_TABS.map((id) => ({
          id,
          icon: <Icon name={id === 'all' ? 'icon/inventory' : `icon/${id}`} scale={1} />,
          label: id === 'all' ? t('ui.inventory.tab.all') : tDyn(`ui.shop.tab.${id}`),
        }))}
        selected={tab}
        onSelect={setTab}
        colors={TAB_COLORS.shop}
        style={{ paddingLeft: 8 }}
      />
      <div id="inventory-panel" role="tabpanel" aria-labelledby={`inventory-tab-${tab}`} style={{ ...tabPanelStyle(TAB_COLORS.shop.selected), flex: 1 }}>
        <SearchField value={query} onChange={setQuery} />
        {query !== '' && items.length === 0 ? (
          <div style={{ padding: 8 }}>{t('ui.search.none')}</div>
        ) : (
          <Inventory layout="grid" items={items} owned={owned} sandbox={sandbox} placing={placing} onPick={pick} onShop={() => useGameStore.getState().openWindow('shop', '')} />
        )}
      </div>
    </div>
  );
}

export function Inventory({
  layout = 'strip',
  items,
  owned,
  sandbox = false,
  placing,
  onPick,
  onShop,
}: {
  // strip: スマホの帯（ツールバーの上）、grid: パソコンのウィンドウの中
  layout?: 'strip' | 'grid';
  items: InventoryItem[];
  owned: Record<string, number>;
  // サンドボックスは在庫の数を ∞ で出す
  sandbox?: boolean;
  placing: string | null;
  onPick: (item: InventoryItem) => void;
  onShop: () => void;
}) {
  const box = layout === 'strip' ? strip : grid;
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
  const onItemPointerDown = (item: InventoryItem) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const touch = e.pointerType === 'touch';
    stopRef.current?.();
    stopRef.current = trackDrag({
      startX: e.clientX,
      startY: e.clientY,
      // 指では、横に動かしたら欄のスクロール、上に引き出したらドラッグとして扱う
      decide: (dx, dy) => (touch && Math.abs(dx) > Math.abs(dy) ? 'abort' : 'drag'),
      onMove: (x, y) => setItemDrag({ id: item.id, x, y }),
      onDrop: (x, y) => dropAt(item.id, x, y),
      onEnd: ({ dragged, reason }) => {
        stopRef.current = null;
        setItemDrag(null);
        // ドラッグのあとに続く click は無視する（止められただけのときは、click は来ない）
        if (dragged && reason !== 'stop') suppressClick();
      },
    });
  };

  if (items.length === 0) {
    return (
      <div style={{ ...box, justifyContent: 'center', overflowX: 'visible', alignItems: 'center' }}>
        <span>{t('ui.inventory.empty')}</span>
        <button style={secondaryButton} onClick={onShop}>
          {t('ui.inventory.openShop')}
        </button>
      </div>
    );
  }
  const dragged = itemDrag ? items.find((item) => item.id === itemDrag.id) : undefined;
  return (
    <>
      <div style={box}>
        {items.map((item) => {
          const key = `${item.kind}-${item.id}`;
          const name =
            item.kind === 'device' ? tDyn(`device.${item.id}.name`) : tDyn(`furniture.${item.id}.name`);
          // 使えない品目は薄暗くし、押しても何もしない。理由はツールチップで出す（設計中の家具）
          const blocked = item.blocked !== undefined;
          return (
            <Tooltip text={blocked ? `${name}
${t('ui.inventory.blocked.design')}` : name} key={key}>
              <button
                aria-label={name}
                aria-disabled={blocked}
                style={blocked ? { ...itemStyle(false), opacity: 0.4, cursor: 'not-allowed' } : itemStyle(placing === item.id)}
                onPointerDown={blocked ? undefined : onItemPointerDown(item)}
                onClick={() => {
                  if (!blocked && !ignoreClick.current) onPick(item);
                }}
              >
                <ItemIcon name={spriteOf(item)} box={{ width: 40, height: 40 }} maxScale={2} />
                <span style={{ position: 'absolute', right: 2, bottom: 0, fontSize: 11, fontWeight: 'bold', textShadow: '0 0 2px #3b2a33' }}>
                  {sandbox ? '∞' : (owned[item.id] ?? 0)}
                </span>
              </button>
            </Tooltip>
          );
        })}
      </div>
      {itemDrag && dragged && (
        // ドラッグ中の品目の絵。ポインターに付いて動く（マップの判定には使わない）
        <div style={{ position: 'fixed', left: itemDrag.x - 16, top: itemDrag.y - 16, pointerEvents: 'none', opacity: 0.85, zIndex: 1000 }}>
          <ItemIcon name={spriteOf(dragged)} box={{ width: 40, height: 40 }} maxScale={2} />
        </div>
      )}
    </>
  );
}
