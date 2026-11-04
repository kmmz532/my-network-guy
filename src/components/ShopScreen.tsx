import { cables, devices, shop } from 'virtual:game-data';
import type { LangKey } from '../generated/lang-keys';
import { hasKey, t } from '../i18n/t';
import { isUnlocked } from '../sim/shop';
import { useGameStore } from '../stores/useGameStore';

// 機材の絵（種類ごとに形を変える。ゲーム画面の機器と同じ配色）
const ICON_COLOR: Record<string, string> = {
  pc: '#dfe3e8',
  server: '#a3acb8',
  l2_switch: '#4f7cc4',
  router: '#e0644f',
};
const OUTLINE = '#3b2a33';

export function DeviceIcon({ category }: { category: string }) {
  const body = ICON_COLOR[category] ?? '#ffffff';
  return (
    <svg width={48} height={48} viewBox="0 0 48 48" shapeRendering="crispEdges" aria-hidden="true">
      {category === 'pc' && (
        <>
          <rect x={8} y={6} width={32} height={24} fill={body} stroke={OUTLINE} strokeWidth={2} />
          <rect x={12} y={10} width={24} height={14} fill="#3b5f8a" />
          <rect x={21} y={30} width={6} height={5} fill={body} stroke={OUTLINE} strokeWidth={2} />
          <rect x={14} y={35} width={20} height={4} fill={body} stroke={OUTLINE} strokeWidth={2} />
        </>
      )}
      {category === 'server' && (
        <>
          <rect x={14} y={4} width={20} height={40} fill={body} stroke={OUTLINE} strokeWidth={2} />
          {[12, 22, 32].map((y) => (
            <rect key={y} x={18} y={y} width={12} height={3} fill="#5a6573" />
          ))}
          <rect x={30} y={38} width={2} height={2} fill="#62d26f" />
        </>
      )}
      {category === 'l2_switch' && (
        <>
          <rect x={4} y={16} width={40} height={20} fill={body} stroke={OUTLINE} strokeWidth={2} />
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <rect key={i} x={8 + i * 4.5} y={28} width={3} height={5} fill={OUTLINE} />
          ))}
        </>
      )}
      {category === 'router' && (
        <>
          <line x1={14} y1={18} x2={14} y2={6} stroke={OUTLINE} strokeWidth={2} />
          <line x1={34} y1={18} x2={34} y2={6} stroke={OUTLINE} strokeWidth={2} />
          <rect x={6} y={18} width={36} height={20} fill={body} stroke={OUTLINE} strokeWidth={2} />
          <rect x={10} y={30} width={4} height={4} fill="#62d26f" />
        </>
      )}
    </svg>
  );
}

const cardStyle = {
  background: '#25406f',
  borderRadius: 4,
  padding: 10,
  display: 'flex',
  gap: 12,
  alignItems: 'flex-start',
  color: '#f4f1e6',
} as const;

// 機材ショップの画面。機材とケーブルを、絵・性能・価格で並べる
export function ShopScreen({ onClose }: { onClose: () => void }) {
  const money = useGameStore((s) => s.clock.money);
  const owned = useGameStore((s) => s.owned);
  const completed = useGameStore((s) => s.completed);
  const buy = useGameStore((s) => s.buy);

  const unlocked = shop.filter((item) => isUnlocked(item, completed));
  const deviceItems = unlocked.filter((i) => i.device !== undefined);
  const cableItems = unlocked.filter((i) => i.cable !== undefined);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(20, 20, 30, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 8,
      }}
    >
      <div
        style={{
          background: '#2f4f8f',
          color: '#f4f1e6',
          padding: 16,
          borderRadius: 6,
          width: 'min(720px, 92vw)',
          maxHeight: '88vh',
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>{t('ui.shop.title')}</h2>
          <button onClick={onClose}>{t('ui.shop.close')}</button>
        </div>
        <div style={{ marginBottom: 8 }}>{t('ui.shop.devices')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 8 }}>
          {deviceItems.map((item) => {
            const device = devices[item.device as keyof typeof devices];
            const port = device.ports[0];
            return (
              <div key={device.id} style={cardStyle}>
                <DeviceIcon category={device.category} />
                <div style={{ flex: 1, fontSize: 13 }}>
                  <div style={{ fontWeight: 'bold' }}>{t(`device.${device.id}.name` as LangKey)}</div>
                  <div style={{ opacity: 0.9 }}>{t(`device.${device.id}.desc` as LangKey)}</div>
                  <div>{t('ui.shop.ports', { count: port.count, speed: port.speedMbps })}</div>
                  {device.features.map((f) =>
                    hasKey(`ui.shop.feature.${f}`) ? <div key={f}>{t(`ui.shop.feature.${f}` as LangKey)}</div> : null,
                  )}
                  <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span>{t('ui.shop.price', { amount: device.price.toLocaleString('ja-JP') })}</span>
                    <span>{t('ui.shop.owned', { count: owned[device.id] ?? 0 })}</span>
                    <button disabled={money < device.price} onClick={() => buy(device.id)}>
                      {t('ui.shop.buy')}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ margin: '12px 0 8px' }}>{t('ui.shop.cables')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 8 }}>
          {cableItems.map((item) => {
            const cable = cables[item.cable as keyof typeof cables];
            return (
              <div key={cable.id} style={{ ...cardStyle, alignItems: 'center' }}>
                <div style={{ width: 48, textAlign: 'center', fontSize: 24 }} aria-hidden="true">
                  {cable.id === 'fiber_sm' ? '〰' : '┅'}
                </div>
                <div style={{ flex: 1, fontSize: 13 }}>
                  <div style={{ fontWeight: 'bold' }}>{t(`cable.${cable.id}.name` as LangKey)}</div>
                  <div>{t('ui.shop.cableSpec', { speed: cable.bandwidthMbps, length: cable.maxLengthTiles })}</div>
                  <div>{t('ui.shop.cablePrice', { link: cable.pricePerLink, tile: cable.pricePerTile })}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
