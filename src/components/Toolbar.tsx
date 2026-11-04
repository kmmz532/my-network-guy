// 画面下のツールバー。依頼・機材・ケーブル・色塗り・施工をアイコンで操作する
import { cables, devices, shop } from 'virtual:game-data';
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import { isUnlocked } from '../sim/shop';
import { COLOR_COUNT } from '../network/compile';
import { subnetCss } from '../game/palette';
import { useGameStore } from '../stores/useGameStore';
import { DeviceIcon } from './DeviceIcon';

const CABLE_CSS: Record<string, string> = { utp_cat5e: '#4a8fd6', fiber_sm: '#f0a030' };

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
  }) as const;

const sep = <span style={{ width: 1, height: 36, background: '#3b2a33', margin: '0 4px' }} />;

export function Toolbar({ onOffers }: { onOffers: () => void }) {
  const offers = useGameStore((s) => s.offers);
  const active = useGameStore((s) => s.active);
  const completed = useGameStore((s) => s.completed);
  const owned = useGameStore((s) => s.owned);
  const placing = useGameStore((s) => s.placing);
  const tool = useGameStore((s) => s.tool);
  const paintColor = useGameStore((s) => s.paintColor);
  const wireCable = useGameStore((s) => s.wireCable);
  const setPlacing = useGameStore((s) => s.setPlacing);
  const setTool = useGameStore((s) => s.setTool);
  const setPaintColor = useGameStore((s) => s.setPaintColor);
  const setWireCable = useGameStore((s) => s.setWireCable);
  const requestBuild = useGameStore((s) => s.requestBuild);
  const abandon = useGameStore((s) => s.abandon);

  const unlocked = shop.filter((item) => isUnlocked(item, completed));
  const deviceIds = unlocked.filter((i) => i.device).map((i) => i.device!);
  const cableIds = unlocked.filter((i) => i.cable).map((i) => i.cable!);
  const design = active?.phase === 'design';
  const yen = (n: number) => n.toLocaleString('ja-JP');

  return (
    <footer style={bar}>
      <button style={{ ...slot(false), position: 'relative' }} title={t('ui.offer.title')} onClick={onOffers}>
        📨
        {offers.length > 0 && (
          <span style={{ position: 'absolute', top: -6, right: -6, background: '#e84a4a', borderRadius: 8, fontSize: 11, padding: '0 5px' }}>
            {offers.length}
          </span>
        )}
      </button>
      {design && (
        <>
          {sep}
          {deviceIds.map((id) => {
            const d = devices[id as keyof typeof devices];
            const stock = owned[id] ?? 0;
            return (
              <button
                key={id}
                style={slot(tool === 'build' && placing === id)}
                title={`${t(`device.${id}.name` as LangKey)} ${yen(d.price)}`}
                onClick={() => {
                  setTool('build');
                  setPlacing(placing === id ? null : id);
                }}
              >
                <DeviceIcon category={d.category} size={34} />
                {stock > 0 && <span style={{ position: 'absolute', fontSize: 10, marginTop: 30, marginLeft: 30 }}>{stock}</span>}
              </button>
            );
          })}
          {sep}
          {cableIds.map((id) => (
            <button
              key={id}
              style={slot(tool === 'build' && !placing && wireCable === id)}
              title={t(`cable.${id}.name` as LangKey)}
              onClick={() => {
                setTool('build');
                setWireCable(id);
              }}
            >
              <svg width={30} height={30} viewBox="0 0 30 30">
                <path d="M3 22 C10 4, 20 26, 27 8" stroke={CABLE_CSS[id] ?? '#9fe0ff'} strokeWidth={4} fill="none" />
              </svg>
              <span style={{ display: 'none' }}>{cables[id as keyof typeof cables]?.maxLengthTiles}</span>
            </button>
          ))}
          {sep}
          {Array.from({ length: COLOR_COUNT }, (_, i) => i + 1).map((c) => (
            <button
              key={c}
              style={{ ...slot(tool === 'paint' && paintColor === c), width: 32 }}
              title="🎨"
              onClick={() => setPaintColor(c)}
            >
              <span style={{ width: 20, height: 20, background: subnetCss(c), border: '2px solid #3b2a33', display: 'block' }} />
            </button>
          ))}
          {sep}
          <button style={{ ...slot(false), width: 'auto', padding: '0 14px', background: '#5aa860', fontSize: 16 }} onClick={() => requestBuild()}>
            🔨 {t('ui.build')}
          </button>
          <span style={{ marginLeft: 8 }}>💸 {yen(active.cost)} / {yen(active.contract.budget)}</span>
          <button style={{ ...slot(false), width: 32, marginLeft: 'auto' }} title={t('ui.project.abandon')} onClick={() => abandon()}>
            ✖
          </button>
        </>
      )}
      {active?.phase === 'build' && (
        <>
          {sep}
          <span>🔨</span>
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
  );
}
