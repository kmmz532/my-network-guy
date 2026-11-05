// 機材ショップ。解禁済みの機材と家具を購入して在庫にする。区分ごとのタブで並べ替える。ケーブルは在庫を持たず、配線のときに費用を払うため、ここには出さない
import { useRef, useState, type KeyboardEvent } from 'react';
import { devices, furniture, shop } from 'virtual:game-data';
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import { isUnlocked } from '../sim/shop';
import { effectText } from '../game/effectText';
import { useGameStore } from '../stores/useGameStore';
import { Icon } from './Icon';
import { Modal, primaryButton } from './Modal';
import { nextShopSection, SHOP_SECTIONS as SECTIONS, type ShopSection as Section } from './shopTabs';

// タブは、パネルの上辺に付いた見出しの形にする。選んでいるタブはパネルと同じ色でつながり、少し上に出る
const PANEL_BG = '#1d3664';
const TAB_BG = '#16294f';
const EDGE = '#f4f1e6';

const tabStyle = (active: boolean) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: active ? '8px 14px 6px' : '6px 12px 4px',
  // パネルの上の縁に2px重ねる。選んでいるタブは下の縁がないのでパネルとつながり、選んでいないタブは縁が境の線になる
  marginBottom: -2,
  border: `2px solid ${EDGE}`,
  borderBottom: active ? 'none' : `2px solid ${EDGE}`,
  borderRadius: '2px 2px 0 0',
  background: active ? PANEL_BG : TAB_BG,
  color: EDGE,
  fontSize: 14,
  fontWeight: active ? 'bold' : 'normal',
  cursor: 'pointer',
  position: 'relative',
  zIndex: 1,
} as const);

const panelStyle = {
  background: PANEL_BG,
  border: `2px solid ${EDGE}`,
  borderRadius: '0 2px 2px 2px',
  padding: 8,
} as const;

export function ShopCards({ onClose }: { onClose: () => void }) {
  const completed = useGameStore((s) => s.completed);
  const owned = useGameStore((s) => s.owned);
  const money = useGameStore((s) => s.clock.money);
  const buy = useGameStore((s) => s.buy);
  const [section, setSection] = useState<Section>('device');
  const tabRefs = useRef<Partial<Record<Section, HTMLButtonElement | null>>>({});
  const ids = shop.filter((i) => i.device && isUnlocked(i, completed)).map((i) => i.device!);
  const furnitureIds = shop.filter((i) => i.furniture && isUnlocked(i, completed)).map((i) => i.furniture!);
  const yen = (n: number) => n.toLocaleString('ja-JP');

  // 矢印キーで隣のタブへ移し、そのタブにフォーカスを渡す
  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const next = nextShopSection(SECTIONS, section, e.key);
    if (!next) return;
    e.preventDefault();
    setSection(next);
    tabRefs.current[next]?.focus();
  };

  // Enter は閉じる（主のボタン）
  return (
    <Modal onClose={onClose} primary={onClose} boxStyle={{ width: 'min(420px, calc(100% - 32px))' }}>
      <div style={{ marginBottom: 8 }}>
        <Icon name="icon/cart" />
      </div>
      <div role="tablist" aria-label={t('ui.shop.title')} style={{ display: 'flex', alignItems: 'flex-end', gap: 4, paddingLeft: 8 }}>
        {SECTIONS.map((s) => {
          const active = section === s;
          return (
            <button
              key={s}
              id={`shop-tab-${s}`}
              ref={(el) => {
                tabRefs.current[s] = el;
              }}
              role="tab"
              aria-selected={active}
              aria-controls="shop-panel"
              tabIndex={active ? 0 : -1}
              style={tabStyle(active)}
              onClick={() => setSection(s)}
              onKeyDown={onTabKeyDown}
            >
              <Icon name={`icon/${s}`} scale={1} />
              {t(`ui.shop.tab.${s}` as LangKey)}
            </button>
          );
        })}
      </div>
      <div id="shop-panel" role="tabpanel" aria-labelledby={`shop-tab-${section}`} style={panelStyle}>
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
                    {effectText(f.effect) && <div style={{ fontSize: 12, color: '#ffd866' }}>{effectText(f.effect)}</div>}
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
      <button style={{ ...primaryButton, display: 'block', marginTop: 8, marginLeft: 'auto' }} onClick={onClose}>
        {t('ui.panel.close')}
      </button>
    </Modal>
  );
}
