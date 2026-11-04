import { useState } from 'react';
import { cables, devices, shop } from 'virtual:game-data';
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import { useGameStore } from '../stores/useGameStore';
import { isUnlocked } from '../sim/shop';

const panelStyle = {
  background: 'rgba(47, 79, 143, 0.9)',
  color: '#f4f1e6',
  padding: 12,
  borderRadius: 4,
  width: 280,
  fontSize: 14,
} as const;

// 解禁済みの機材とケーブルを陳列する。ケーブルは配線のたびに費用がかかるため、購入はしない
export function ShopPanel() {
  const money = useGameStore((s) => s.clock.money);
  const owned = useGameStore((s) => s.owned);
  const completed = useGameStore((s) => s.completed);
  const buy = useGameStore((s) => s.buy);
  const [message, setMessage] = useState('');

  return (
    <section style={panelStyle}>
      <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>{t('ui.shop.title')}</h2>
      {shop
        .filter((item) => isUnlocked(item, completed))
        .map((item) => {
          if (item.device) {
            const device = devices[item.device as keyof typeof devices];
            const name = t(`device.${device.id}.name` as LangKey);
            return (
              <div key={`d:${device.id}`} style={{ marginBottom: 8 }}>
                <div>
                  {name}：{device.price.toLocaleString('ja-JP')} 円
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span>{t('ui.shop.owned', { count: owned[device.id] ?? 0 })}</span>
                  <button
                    onClick={() => setMessage(buy(device.id) ? '' : t('ui.shop.nomoney'))}
                    disabled={money < device.price}
                  >
                    {t('ui.shop.buy')}
                  </button>
                </div>
              </div>
            );
          }
          const cable = cables[item.cable as keyof typeof cables];
          return (
            <div key={`c:${cable.id}`} style={{ marginBottom: 8 }}>
              <div>{t(`cable.${cable.id}.name` as LangKey)}</div>
              <div>{t('ui.shop.cablePrice', { link: cable.pricePerLink, tile: cable.pricePerTile })}</div>
            </div>
          );
        })}
      {message && <div style={{ color: '#ffd866' }}>{message}</div>}
    </section>
  );
}

