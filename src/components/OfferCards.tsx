// 依頼カード。タイトル1行と、PC台数・予算・報酬のアイコンで表す
import { devices } from 'virtual:game-data';
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import { useGameStore } from '../stores/useGameStore';
import { modalBack, modalBox } from './Overlay';

export function OfferCards({ onClose }: { onClose: () => void }) {
  const offers = useGameStore((s) => s.offers);
  const busy = useGameStore((s) => s.active !== null);
  const accept = useGameStore((s) => s.accept);
  const yen = (n: number) => n.toLocaleString('ja-JP');

  return (
    <div style={modalBack} onClick={onClose}>
      <div style={{ ...modalBox, minWidth: 320 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 18, marginBottom: 8 }}>📨</div>
        {offers.length === 0 && <div style={{ opacity: 0.7 }}>…</div>}
        {offers.map((offer) => {
          const hosts = offer.contract.placed.filter((p) => {
            const c = devices[p.device as keyof typeof devices]?.category;
            return c === 'pc' || c === 'server';
          }).length;
          return (
            <div key={offer.id} style={{ background: '#25406f', borderRadius: 4, padding: 10, marginBottom: 8 }}>
              <div style={{ fontWeight: 'bold', marginBottom: 4 }}>
                {t(`contract.${offer.baseId}.title` as LangKey, offer.params)}
              </div>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                <span>🖥×{hosts}</span>
                <span>💸 {yen(offer.contract.budget)}</span>
                <span style={{ color: '#ffd866' }}>💰 {yen(offer.contract.reward.money)}</span>
                <button
                  style={{ marginLeft: 'auto', padding: '4px 12px', cursor: 'pointer' }}
                  disabled={busy}
                  onClick={() => {
                    if (accept(offer.id) === null) onClose();
                  }}
                >
                  {t('ui.accept')}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
