// 機材ショップ。解禁済みの機材と家具を購入して在庫にする。ケーブルは配線した長さで費用がかかるため並べない
import { devices, furniture, shop } from 'virtual:game-data';
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import { isUnlocked } from '../sim/shop';
import { useGameStore } from '../stores/useGameStore';
import { Icon } from './Icon';
import { modalBack, modalBox } from './Overlay';

export function ShopCards({ onClose }: { onClose: () => void }) {
  const completed = useGameStore((s) => s.completed);
  const owned = useGameStore((s) => s.owned);
  const money = useGameStore((s) => s.clock.money);
  const buy = useGameStore((s) => s.buy);
  const ids = shop.filter((i) => i.device && isUnlocked(i, completed)).map((i) => i.device!);
  const furnitureIds = shop.filter((i) => i.furniture && isUnlocked(i, completed)).map((i) => i.furniture!);
  const yen = (n: number) => n.toLocaleString('ja-JP');

  return (
    <div style={modalBack} onClick={onClose}>
      <div style={{ ...modalBox, minWidth: 320 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ marginBottom: 8 }}>
          <Icon name="icon/cart" />
        </div>
        {ids.map((id) => {
          const d = devices[id as keyof typeof devices];
          return (
            <div
              key={id}
              style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#25406f', borderRadius: 4, padding: 8, marginBottom: 6 }}
            >
              <Icon name={d.sprite} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'bold' }}>{t(`device.${id}.name` as LangKey)}</div>
                <div style={{ fontSize: 12, opacity: 0.85 }}>{t(`device.${id}.desc` as LangKey)}</div>
                <div style={{ fontSize: 12 }}>
                  {t('ui.shop.spec', { ports: d.ports.reduce((sum, p) => sum + p.count, 0), speed: d.ports[0]?.speedMbps ?? 0 })}
                </div>
                <div style={{ fontSize: 13 }}>
                  <Icon name="icon/money" scale={1} /> {yen(d.price)}　×{owned[id] ?? 0}
                </div>
              </div>
              <button style={{ padding: '4px 12px', cursor: 'pointer' }} disabled={money < d.price} onClick={() => buy(id)}>
                {t('ui.shop.buy')}
              </button>
            </div>
          );
        })}
        {furnitureIds.length > 0 && (
          <div style={{ fontWeight: 'bold', margin: '8px 0 4px' }}>{t('ui.shop.section.furniture')}</div>
        )}
        {furnitureIds.map((id) => {
          const f = furniture[id as keyof typeof furniture];
          return (
            <div
              key={`furniture-${id}`}
              style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#25406f', borderRadius: 4, padding: 8, marginBottom: 6 }}
            >
              <div style={{ width: 64, display: 'flex', justifyContent: 'center' }}>
                <Icon name={`furniture/${id}`} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'bold' }}>{t(`furniture.${id}.name` as LangKey)}</div>
                <div style={{ fontSize: 12, opacity: 0.85 }}>{t(`furniture.${id}.desc` as LangKey)}</div>
                <div style={{ fontSize: 13 }}>
                  <Icon name="icon/money" scale={1} /> {yen(f.price)}　×{owned[id] ?? 0}
                </div>
              </div>
              <button style={{ padding: '4px 12px', cursor: 'pointer' }} disabled={money < f.price} onClick={() => buy(id)}>
                {t('ui.shop.buy')}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
