// 機材ショップ。解禁済みの機材と家具を購入して在庫にする。区分ごとのタブで並べ替える。ケーブルは在庫を持たず、配線のときに費用を払うため、ここには出さない
import { useState } from 'react';
import { devices, furniture, shop } from 'virtual:game-data';
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import { isUnlocked } from '../sim/shop';
import { effectText } from '../game/effectText';
import { useGameStore } from '../stores/useGameStore';
import { Icon } from './Icon';
import { Modal, primaryButton, secondaryButton } from './Modal';
import { Tabs, TAB_COLORS, tabPanelStyle } from './Tabs';
import { RADIUS } from '../ui/theme';

// 区分のタブ（並びの順）
type Section = 'device' | 'furniture';
const SECTIONS: readonly Section[] = ['device', 'furniture'];

export function ShopCards({ onClose }: { onClose: () => void }) {
  const completed = useGameStore((s) => s.completed);
  // サンドボックスは解禁の条件を無視し、費用は 0
  const sandbox = useGameStore((s) => s.mode) === 'sandbox';
  const owned = useGameStore((s) => s.owned);
  const money = useGameStore((s) => s.clock.money);
  const buy = useGameStore((s) => s.buy);
  const [section, setSection] = useState<Section>('device');
  const ids = shop.filter((i) => i.device && isUnlocked(i, completed, sandbox)).map((i) => i.device!);
  const furnitureIds = shop.filter((i) => i.furniture && isUnlocked(i, completed, sandbox)).map((i) => i.furniture!);
  const yen = (n: number) => n.toLocaleString('ja-JP');
  const cost = (n: number) => (sandbox ? 0 : n);

  // Enter は閉じる（主のボタン）
  return (
    <Modal onClose={onClose} primary={onClose} boxStyle={{ width: 'min(420px, calc(100% - 32px))' }}>
      <div style={{ marginBottom: 8 }}>
        <Icon name="icon/cart" />
      </div>
      <Tabs
        idPrefix="shop-tab"
        ariaLabel={t('ui.shop.title')}
        items={SECTIONS.map((s) => ({ id: s, icon: <Icon name={`icon/${s}`} scale={1} />, label: t(`ui.shop.tab.${s}` as LangKey) }))}
        selected={section}
        onSelect={setSection}
        colors={TAB_COLORS.shop}
        style={{ paddingLeft: 8 }}
      />
      <div id="shop-panel" role="tabpanel" aria-labelledby={`shop-tab-${section}`} style={tabPanelStyle(TAB_COLORS.shop.selected)}>
        <div style={{ maxHeight: 'min(60vh, 480px)', overflowY: 'auto', paddingRight: 4 }}>
          {section === 'device' &&
            ids.map((id) => {
              const d = devices[id as keyof typeof devices];
              return (
                <div
                  key={id}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#25406f', borderRadius: RADIUS.none, padding: 8, marginBottom: 6 }}
                >
                  <Icon name={d.sprite} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold' }}>{t(`device.${id}.name` as LangKey)}</div>
                    <div style={{ fontSize: 12, opacity: 0.85 }}>{t(`device.${id}.desc` as LangKey)}</div>
                    <div style={{ fontSize: 12 }}>
                      {t('ui.shop.spec', { ports: d.ports.reduce((sum, p) => sum + p.count, 0), speed: d.ports[0]?.speedMbps ?? 0 })}
                    </div>
                    <div style={{ fontSize: 13 }}>
                      <Icon name="icon/money" scale={1} /> {yen(cost(d.price))}　×{owned[id] ?? 0}
                    </div>
                  </div>
                  <button style={{ ...secondaryButton, opacity: money < cost(d.price) ? 0.4 : 1 }} disabled={money < cost(d.price)} onClick={() => buy(id)}>
                    {t('ui.shop.buy')}
                  </button>
                </div>
              );
            })}
          {section === 'furniture' &&
            furnitureIds.map((id) => {
              const f = furniture[id as keyof typeof furniture];
              return (
                <div
                  key={`furniture-${id}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#25406f', borderRadius: RADIUS.none, padding: 8, marginBottom: 6 }}
                >
                  <div style={{ width: 64, display: 'flex', justifyContent: 'center' }}>
                    <Icon name={`furniture/${id}`} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold' }}>{t(`furniture.${id}.name` as LangKey)}</div>
                    <div style={{ fontSize: 12, opacity: 0.85 }}>{t(`furniture.${id}.desc` as LangKey)}</div>
                    {effectText(f.effect) && <div style={{ fontSize: 12, color: '#ffd866' }}>{effectText(f.effect)}</div>}
                    <div style={{ fontSize: 13 }}>
                      <Icon name="icon/money" scale={1} /> {yen(cost(f.price))}　×{owned[id] ?? 0}
                    </div>
                  </div>
                  <button style={{ ...secondaryButton, opacity: money < cost(f.price) ? 0.4 : 1 }} disabled={money < cost(f.price)} onClick={() => buy(id)}>
                    {t('ui.shop.buy')}
                  </button>
                </div>
              );
            })}
        </div>
      </div>
      <button style={{ ...primaryButton, display: 'block', marginTop: 8, marginLeft: 'auto' }} onClick={onClose}>
        {t('ui.panel.close')}
      </button>
    </Modal>
  );
}
