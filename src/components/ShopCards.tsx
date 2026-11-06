// ショップ。解禁済みの機材と家具を購入して在庫にする。区分ごとのタブで並べ替える。ケーブルは在庫を持たず、配線のときに費用を払うため、ここには出さない
import { useState } from 'react';
import { balance, devices, furniture, shop } from 'virtual:game-data';
import { t, tDyn } from '../i18n/t';
import { isUnlocked, type ItemDefs } from '../sim/shop';
import { levelOf } from '../sim/level';
import { balance as gameBalance, cables as gameCables, devices as gameDevices, furniture as gameFurniture } from 'virtual:game-data';

// 店の解放の判定に使う定義（品目の解放のレベル）
const itemDefs: ItemDefs = { devices: gameDevices, furniture: gameFurniture, cables: gameCables };
import { effectText } from '../game/effectText';
import { useGameStore } from '../stores/useGameStore';
import { Icon } from './Icon';
import { secondaryButton } from './Modal';
import { Tabs, TAB_COLORS, tabPanelStyle } from './Tabs';
import { RADIUS } from '../ui/theme';
import { matchesQuery } from '../ui/search';
import { SearchField } from './SearchField';
import { ItemIcon as SharedItemIcon } from './ItemIcon';

// 区分のタブ（並びの順）
type Section = 'device' | 'furniture';
const SECTIONS: readonly Section[] = ['device', 'furniture'];

// 品目の絵。透明な余白を切り落とし、固定の枠の中央に収める。
// 枠の高さは、最も背の高い品目（本棚 49 px）を 2 倍で収められる 98 px。これより低いと、背の高い品目だけ 1 倍に縮む
const ITEM_ICON_BOX = { width: 64, height: 98 };
const ItemIcon = ({ name }: { name: string }) => <SharedItemIcon name={name} box={ITEM_ICON_BOX} maxScale={3} />;

// ショップの中身（ウィンドウの中に出す。マップの操作は止めない）
export function ShopBody() {
  // 解放は会社のレベルで決まる（N45）
  const level = levelOf(useGameStore((s) => s.companyExp), gameBalance);
  // サンドボックスは解禁の条件を無視し、費用は 0
  const sandbox = useGameStore((s) => s.mode) === 'sandbox';
  const owned = useGameStore((s) => s.owned);
  const money = useGameStore((s) => s.clock.money);
  const buy = useGameStore((s) => s.buy);
  const sell = useGameStore((s) => s.sell);
  const [section, setSection] = useState<Section>('device');
  // 検索は選んでいるタブの中で絞り込む（N67）
  const [query, setQuery] = useState('');
  const ids = shop.filter((i) => i.device && isUnlocked(i, level, itemDefs, sandbox)).map((i) => i.device!);
  const furnitureIds = shop.filter((i) => i.furniture && isUnlocked(i, level, itemDefs, sandbox)).map((i) => i.furniture!);
  const yen = (n: number) => n.toLocaleString('ja-JP');
  const cost = (n: number) => (sandbox ? 0 : n);
  const deviceRows = ids.filter((id) => matchesQuery(query, [tDyn(`device.${id}.name`), tDyn(`device.${id}.kana`), id, tDyn(`category.${devices[id as keyof typeof devices].category}`)]));
  const furnitureRows = furnitureIds.filter((id) => matchesQuery(query, [tDyn(`furniture.${id}.name`), tDyn(`furniture.${id}.kana`), id]));

  return (
    <div>
      <Tabs
        idPrefix="shop-tab"
        ariaLabel={t('ui.shop.title')}
        items={SECTIONS.map((s) => ({ id: s, icon: <Icon name={`icon/${s}`} scale={1} />, label: tDyn(`ui.shop.tab.${s}`) }))}
        selected={section}
        onSelect={setSection}
        colors={TAB_COLORS.shop}
        style={{ paddingLeft: 8 }}
      />
      <div id="shop-panel" role="tabpanel" aria-labelledby={`shop-tab-${section}`} style={tabPanelStyle(TAB_COLORS.shop.selected)}>
        <SearchField value={query} onChange={setQuery} />
        <div style={{ maxHeight: 'min(60vh, 480px)', overflowY: 'auto', paddingRight: 4 }}>
          {section === 'device' &&
            deviceRows.map((id) => {
              const d = devices[id as keyof typeof devices];
              return (
                <div
                  key={id}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#25406f', borderRadius: RADIUS.none, padding: 8, marginBottom: 6 }}
                >
                  <ItemIcon name={d.sprite} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold' }}>{tDyn(`device.${id}.name`)}</div>
                    <div style={{ fontSize: 12, opacity: 0.85 }}>{tDyn(`device.${id}.desc`)}</div>
                    <div style={{ fontSize: 12 }}>
                      {t('ui.shop.spec', { ports: d.ports.reduce((sum, p) => sum + p.count, 0), speed: d.ports[0]?.speedMbps ?? 0 })}
                    </div>
                    <div style={{ fontSize: 13 }}>
                      <Icon name="icon/money" scale={1} /> {yen(cost(d.price))}　×{owned[id] ?? 0}
                    </div>
                    {/* 売却の値段は、ボタンではなく値段の下に小さく出す（ボタンの幅をそろえる） */}
                    {!sandbox && <div style={{ fontSize: 12, opacity: 0.85 }}>{t('ui.shop.sellPrice', { price: yen(Math.floor(d.price * balance.sellRate)) })}</div>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 64 }}>
                    <button style={{ ...secondaryButton, opacity: money < cost(d.price) ? 0.4 : 1 }} disabled={money < cost(d.price)} onClick={() => buy(id)}>
                      {t('ui.shop.buy')}
                    </button>
                    {!sandbox && (
                      <button style={{ ...secondaryButton, opacity: (owned[id] ?? 0) > 0 ? 1 : 0.4 }} disabled={(owned[id] ?? 0) <= 0} onClick={() => sell(id)}>
                        {t('ui.shop.sell')}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          {query !== '' && (section === 'device' ? deviceRows : furnitureRows).length === 0 && <div style={{ padding: 8 }}>{t('ui.search.none')}</div>}
          {section === 'furniture' &&
            furnitureRows.map((id) => {
              const f = furniture[id as keyof typeof furniture];
              return (
                <div
                  key={`furniture-${id}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#25406f', borderRadius: RADIUS.none, padding: 8, marginBottom: 6 }}
                >
                  <ItemIcon name={f.sprite} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold' }}>{tDyn(`furniture.${id}.name`)}</div>
                    <div style={{ fontSize: 12, opacity: 0.85 }}>{tDyn(`furniture.${id}.desc`)}</div>
                    {effectText(f.effect) && <div style={{ fontSize: 12, color: '#ffd866' }}>{effectText(f.effect)}</div>}
                    <div style={{ fontSize: 13 }}>
                      <Icon name="icon/money" scale={1} /> {yen(cost(f.price))}　×{owned[id] ?? 0}
                    </div>
                    {!sandbox && <div style={{ fontSize: 12, opacity: 0.85 }}>{t('ui.shop.sellPrice', { price: yen(Math.floor(f.price * balance.sellRate)) })}</div>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 64 }}>
                    <button style={{ ...secondaryButton, opacity: money < cost(f.price) ? 0.4 : 1 }} disabled={money < cost(f.price)} onClick={() => buy(id)}>
                      {t('ui.shop.buy')}
                    </button>
                    {!sandbox && (
                      <button style={{ ...secondaryButton, opacity: (owned[id] ?? 0) > 0 ? 1 : 0.4 }} disabled={(owned[id] ?? 0) <= 0} onClick={() => sell(id)}>
                        {t('ui.shop.sell')}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
