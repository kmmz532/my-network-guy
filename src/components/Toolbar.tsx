// 画面下のツールバー。依頼・機材・ケーブル・色塗り・施工をアイコンで操作する
import { useState } from 'react';
import { shop } from 'virtual:game-data';
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import { isUnlocked } from '../sim/shop';
import { warehouseItems, warehouseMode, type WarehouseItem } from '../sim/warehouse';
import { COLOR_COUNT } from '../network/compile';
import { subnetCss } from '../game/palette';
import { useGameStore } from '../stores/useGameStore';
import { Icon } from './Icon';
import { Warehouse } from './Warehouse';

const bar = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  padding: '6px 12px',
  background: 'rgba(47, 79, 143, 0.92)',
  color: '#f4f1e6',
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
} as const;

const slot = (active: boolean) =>
  ({
    width: 44,
    height: 44,
    padding: 2,
    border: `2px solid ${active ? '#ffd866' : '#3b2a33'}`,
    background: active ? '#3a5fa8' : '#25406f',
    borderRadius: 4,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#f4f1e6',
    fontSize: 18,
    position: 'relative',
  }) as const;

const sep = <span style={{ width: 1, height: 36, background: '#3b2a33', margin: '0 4px' }} />;

export function Toolbar({ onOffers, onShop }: { onOffers: () => void; onShop: () => void }) {
  const offers = useGameStore((s) => s.offers);
  const active = useGameStore((s) => s.active);
  const completed = useGameStore((s) => s.completed);
  const owned = useGameStore((s) => s.owned);
  const [warehouseOpen, setWarehouseOpen] = useState(false);
  const placing = useGameStore((s) => s.placing);
  const tool = useGameStore((s) => s.tool);
  const paintColor = useGameStore((s) => s.paintColor);
  const wireCable = useGameStore((s) => s.wireCable);
  const setTool = useGameStore((s) => s.setTool);
  const setPlacing = useGameStore((s) => s.setPlacing);
  const setPaintColor = useGameStore((s) => s.setPaintColor);
  const setWireCable = useGameStore((s) => s.setWireCable);
  const requestBuild = useGameStore((s) => s.requestBuild);
  const abandon = useGameStore((s) => s.abandon);
  const showIp = useGameStore((s) => s.showIp);
  const setShowIp = useGameStore((s) => s.setShowIp);

  const showcase = useGameStore((s) => s.showcase);
  const unlocked = shop.filter((item) => isUnlocked(item, completed));
  const cableIds = unlocked.filter((i) => i.cable).map((i) => i.cable!);
  const design = active?.phase === 'design';
  const yen = (n: number) => n.toLocaleString('ja-JP');
  // 倉庫の在庫の合計（機材と家具の個数の和）
  const stockTotal = Object.values(owned).reduce((sum, n) => sum + n, 0);
  const mode = warehouseMode(active?.phase ?? null, showcase !== null);
  const warehouseItemList = warehouseItems(mode, shop, completed, owned);
  const warehouseOpenable = mode !== 'closed';

  // 品目を選ぶと配置に入る。同じ品目をもう一度押すと配置を終えて欄を閉じる
  const pickWarehouseItem = (item: WarehouseItem) => {
    setTool('build');
    if (placing === item.id) {
      setPlacing(null);
      setWarehouseOpen(false);
    } else {
      setPlacing(item.id);
    }
  };

  return (
    <>
    <footer style={bar}>
      <button style={{ ...slot(false), position: 'relative' }} title={t('ui.offer.title')} onClick={onOffers}>
        <Icon name="icon/mail" />
        {offers.length > 0 && (
          <span style={{ position: 'absolute', top: -6, right: -6, background: '#e84a4a', borderRadius: 8, fontSize: 11, padding: '0 5px' }}>
            {offers.length}
          </span>
        )}
      </button>
      <button style={slot(false)} title={t('ui.shop.title')} onClick={onShop}>
        <Icon name="icon/cart" />
      </button>
      {/* 在庫は倉庫のアイコンにまとめる。品目の一覧は倉庫の欄で開く */}
      {sep}
      <button
        style={{ ...slot(warehouseOpen && warehouseOpenable), opacity: warehouseOpenable ? 1 : 0.35 }}
        title={t('ui.warehouse.title')}
        disabled={!warehouseOpenable}
        onClick={() => setWarehouseOpen(!warehouseOpen)}
      >
        <Icon name="icon/warehouse" scale={1} />
        <span style={{ position: 'absolute', right: 2, bottom: 0, fontSize: 11, fontWeight: 'bold', textShadow: '0 0 2px #3b2a33' }}>
          {stockTotal}
        </span>
      </button>
      {design && (
        <>
          {sep}
          {cableIds.map((id) => (
            <button
              key={id}
              style={slot(tool === 'build' && !placing && wireCable === id)}
              title={t(`cable.${id}.name` as LangKey)}
              onClick={() => {
                setTool('build');
                setWireCable(id);
                setWarehouseOpen(false);
              }}
            >
              <Icon name={`icon/cable_${id}`} />
            </button>
          ))}
          {sep}
          {Array.from({ length: COLOR_COUNT }, (_, i) => i + 1).map((c) => (
            <button
              key={c}
              style={{ ...slot(tool === 'paint' && paintColor === c), width: 32 }}
              title={t('ui.paint')}
              onClick={() => {
                setPaintColor(c);
                setWarehouseOpen(false);
              }}
            >
              <span style={{ width: 20, height: 20, background: subnetCss(c), border: '2px solid #3b2a33', display: 'block' }} />
            </button>
          ))}
          <button
            style={{ ...slot(showIp), width: 'auto', padding: '0 8px', fontSize: 13, fontWeight: 'bold' }}
            title={t('ui.showIp')}
            onClick={() => setShowIp(!showIp)}
          >
            IP
          </button>
          {sep}
          <button style={{ ...slot(false), width: 'auto', padding: '0 14px', background: '#5aa860', fontSize: 16 }} onClick={() => requestBuild()}>
            <Icon name="icon/hammer" /> {t('ui.build')}
          </button>
          <span style={{ marginLeft: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Icon name="icon/budget" /> {yen(active.cost)} / {yen(active.contract.budget)}
          </span>
          <button style={{ ...slot(false), width: 32, marginLeft: 'auto' }} title={t('ui.project.abandon')} onClick={() => abandon()}>
            <Icon name="icon/close" />
          </button>
        </>
      )}
      {active?.phase === 'build' && (
        <>
          {sep}
          <Icon name="icon/hammer" />
          <div style={{ width: 200, height: 10, background: '#3b2a33', borderRadius: 2 }}>
            <div
              style={{
                width: `${active.total ? Math.min(100, (active.progress / active.total) * 100) : 0}%`,
                height: '100%',
                background: '#ffd866',
              }}
            />
          </div>
        </>
      )}
    </footer>
    {warehouseOpen && warehouseOpenable && (
      <Warehouse
        items={warehouseItemList}
        owned={owned}
        placing={placing}
        onPick={pickWarehouseItem}
        onShop={onShop}
      />
    )}
    </>
  );
}
