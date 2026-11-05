// 倉庫の欄。ツールバーの上に横スクロールで在庫の品目を並べる。品目を押すと配置の操作に入る
import { devices } from 'virtual:game-data';
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import type { WarehouseItem } from '../sim/warehouse';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';

const strip = {
  position: 'absolute',
  left: 12,
  right: 12,
  bottom: 64,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: 6,
  overflowX: 'auto',
  background: 'rgba(47, 79, 143, 0.95)',
  color: '#f4f1e6',
  border: '2px solid #3b2a33',
  borderRadius: 6,
} as const;

const itemStyle = (active: boolean) =>
  ({
    flex: '0 0 auto',
    width: 52,
    height: 52,
    padding: 2,
    border: `2px solid ${active ? '#ffd866' : '#3b2a33'}`,
    background: active ? '#3a5fa8' : '#25406f',
    borderRadius: 4,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#f4f1e6',
    position: 'relative',
  }) as const;

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
  return (
    <div style={strip}>
      {items.map((item) => {
        const key = `${item.kind}-${item.id}`;
        const name =
          item.kind === 'device' ? t(`device.${item.id}.name` as LangKey) : t(`furniture.${item.id}.name` as LangKey);
        const sprite = item.kind === 'device' ? devices[item.id as keyof typeof devices].sprite : `furniture/${item.id}`;
        return (
          <Tooltip text={name} key={key}><button aria-label={name} style={itemStyle(placing === item.id)} onClick={() => onPick(item)}>
            <Icon name={sprite} scale={1} />
            <span style={{ position: 'absolute', right: 2, bottom: 0, fontSize: 11, fontWeight: 'bold', textShadow: '0 0 2px #3b2a33' }}>
              {owned[item.id] ?? 0}
            </span>
          </button></Tooltip>
        );
      })}
    </div>
  );
}
