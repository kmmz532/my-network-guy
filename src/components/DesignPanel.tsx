import type { LangKey } from '../generated/lang-keys';
import { shop } from 'virtual:game-data';
import { t } from '../i18n/t';
import { isUnlocked } from '../sim/shop';
import { useGameStore } from '../stores/useGameStore';

const panelStyle = {
  background: 'rgba(47, 79, 143, 0.9)',
  color: '#f4f1e6',
  padding: 12,
  borderRadius: 4,
  width: 280,
  fontSize: 14,
} as const;

// 設計の操作: 在庫の機材を配置する、配線に使うケーブルを選ぶ、選んだ機器を撤去する
export function DesignPanel() {
  const active = useGameStore((s) => s.active);
  const owned = useGameStore((s) => s.owned);
  const completed = useGameStore((s) => s.completed);
  const placing = useGameStore((s) => s.placing);
  const wireCable = useGameStore((s) => s.wireCable);
  const selectedUid = useGameStore((s) => s.selectedUid);
  const setPlacing = useGameStore((s) => s.setPlacing);
  const setWireCable = useGameStore((s) => s.setWireCable);
  const removeNode = useGameStore((s) => s.removeNode);
  const setSelected = useGameStore((s) => s.setSelected);

  if (!active || active.phase !== 'design') return null;

  const stock = Object.entries(owned).filter(([, count]) => count > 0);
  const unlockedCables = shop
    .filter((item) => item.cable !== undefined && isUnlocked(item, completed))
    .map((item) => item.cable!);

  return (
    <section style={panelStyle}>
      <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>{t('ui.design.title')}</h2>
      {placing && (
        <div style={{ marginBottom: 8 }}>
          <div>
            {t('ui.design.placeMode', { name: t(`device.${placing}.name` as LangKey) })}
          </div>
          <button onClick={() => setPlacing(null)}>{t('ui.design.cancel')}</button>
        </div>
      )}
      {stock.length === 0 && <div>{t('ui.design.empty')}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
        {stock.map(([id, count]) => (
          <button key={id} onClick={() => setPlacing(id)} disabled={placing === id}>
            {t('ui.design.own', { name: t(`device.${id}.name` as LangKey), count })}
          </button>
        ))}
      </div>
      <label style={{ display: 'block', marginBottom: 8 }}>
        {t('ui.design.cable')}{' '}
        <select value={wireCable} onChange={(e) => setWireCable(e.target.value)}>
          {unlockedCables.map((id) => (
            <option key={id} value={id}>
              {t(`cable.${id}.name` as LangKey)}
            </option>
          ))}
        </select>
      </label>
      {selectedUid && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <span>{t('ui.design.selected', { name: selectedUid })}</span>
          <button
            onClick={() => {
              if (removeNode(selectedUid) === null) setSelected(null);
            }}
          >
            {t('ui.design.remove')}
          </button>
        </div>
      )}
      <div style={{ fontSize: 12, opacity: 0.9 }}>{t('ui.design.hint')}</div>
    </section>
  );
}
