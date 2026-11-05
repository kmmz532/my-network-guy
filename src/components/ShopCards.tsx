// 機材ショップ。解禁済みの機材と家具を購入して在庫にする。区分ごとのタブで並べ替え、ケーブルは配線した長さで費用がかかるため購入の対象にしない
import { useState } from 'react';
import { cables, devices, furniture, shop } from 'virtual:game-data';
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import { isUnlocked } from '../sim/shop';
import { useGameStore } from '../stores/useGameStore';
import { Icon } from './Icon';
import { modalBack, modalBox } from './Overlay';

type Section = 'device' | 'cable' | 'furniture';
const SECTIONS: Section[] = ['device', 'cable', 'furniture'];

const tabStyle = (active: boolean) => ({
  padding: '4px 12px',
  cursor: 'pointer',
  background: active ? '#f4f1e6' : 'transparent',
  color: active ? '#2f4f8f' : '#f4f1e6',
  border: '1px solid #f4f1e6',
  borderRadius: 4,
  fontWeight: active ? 'bold' : 'normal',
});

export function ShopCards({ onClose }: { onClose: () => void }) {
  const completed = useGameStore((s) => s.completed);
  const owned = useGameStore((s) => s.owned);
  const money = useGameStore((s) => s.clock.money);
  const buy = useGameStore((s) => s.buy);
  const [section, setSection] = useState<Section>('device');
  const ids = shop.filter((i) => i.device && isUnlocked(i, completed)).map((i) => i.device!);
  const furnitureIds = shop.filter((i) => i.furniture && isUnlocked(i, completed)).map((i) => i.furniture!);
  const cableIds = shop.filter((i) => i.cable && isUnlocked(i, completed)).map((i) => i.cable!);
  const yen = (n: number) => n.toLocaleString('ja-JP');

  return (
    <div style={modalBack} onClick={onClose}>
      <div style={{ ...modalBox, width: 'min(420px, calc(100vw - 32px))' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ marginBottom: 8 }}>
          <Icon name="icon/cart" />
        </div>
        <div role="tablist" style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {SECTIONS.map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={section === s}
              style={tabStyle(section === s)}
              onClick={() => setSection(s)}
            >
              {t(`ui.shop.tab.${s}` as LangKey)}
            </button>
          ))}
        </div>
        <div style={{ maxHeight: 'min(60vh, 480px)', overflowY: 'auto', paddingRight: 4 }}>
          {section === 'device' &&
            ids.map((id) => {
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
          {section === 'cable' && (
            <>
              <div style={{ fontSize: 12, marginBottom: 6 }}>{t('ui.shop.cable.note')}</div>
              {cableIds.map((id) => (
                <div
                  key={id}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#25406f', borderRadius: 4, padding: 8, marginBottom: 6 }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold' }}>{t(`cable.${id}.name` as LangKey)}</div>
                    <div style={{ fontSize: 13 }}>
                      <Icon name="icon/money" scale={1} /> {t('ui.shop.cable.perTile', { price: yen(cables[id as keyof typeof cables].pricePerTile) })}
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
          {section === 'furniture' &&
            furnitureIds.map((id) => {
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
    </div>
  );
}
