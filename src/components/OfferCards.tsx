// 依頼カード。タイトル1行と、PC台数・予算・報酬のアイコンで表す
import { devices } from 'virtual:game-data';
import type { LangKey } from '../generated/lang-keys';
import { hasKey, t } from '../i18n/t';
import { goalText } from './goalText';
import { useGameStore } from '../stores/useGameStore';
import { modalBack, modalBox } from './Overlay';
import { Icon } from './Icon';

export function OfferCards({ onClose }: { onClose: () => void }) {
  const offers = useGameStore((s) => s.offers);
  const busy = useGameStore((s) => s.active !== null);
  const accept = useGameStore((s) => s.accept);
  const yen = (n: number) => n.toLocaleString('ja-JP');

  return (
    <div style={modalBack} onClick={onClose}>
      <div style={{ ...modalBox, minWidth: 320 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ marginBottom: 8 }}>
          <Icon name="icon/mail" />
        </div>
        {offers.length === 0 && <div style={{ opacity: 0.7 }}>…</div>}
        {offers.map((offer) => {
          const hosts = offer.contract.placed.filter((p) => {
            const c = devices[p.device as keyof typeof devices]?.category;
            return c === 'pc' || c === 'server';
          }).length;
          return (
            <div key={offer.id} style={{ background: '#25406f', borderRadius: 4, padding: 10, marginBottom: 8 }}>
              <div style={{ fontWeight: 'bold', marginBottom: 4 }}>
                {offer.contract.inhouse && (
                  <span style={{ background: '#5aa860', borderRadius: 3, padding: '0 6px', marginRight: 6, fontSize: 12 }}>
                    {t('ui.offer.inhouse')}
                  </span>
                )}
                {t(`contract.${offer.baseId}.title` as LangKey, offer.params)}
              </div>
              <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 6 }}>
                {t(`contract.${offer.baseId}.story` as LangKey, offer.params)}
              </div>
              {offer.contract.goals.map((goal, i) => (
                <div key={i} style={{ fontSize: 12, opacity: 0.85 }}>
                  ・{goalText(goal)}
                </div>
              ))}
              {hasKey(`contract.${offer.baseId}.hint`) && (
                <div style={{ fontSize: 12, color: '#ffd866', marginTop: 4 }}>
                  {t('ui.task.hint', { text: t(`contract.${offer.baseId}.hint` as LangKey) })}
                </div>
              )}
              <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                <span>
                  <Icon name="icon/pc_count" /> ×{hosts}
                </span>
                <span>
                  <Icon name="icon/budget" /> {yen(offer.contract.budget)}
                </span>
                <span style={{ color: '#ffd866' }}>
                  <Icon name="icon/money" /> {yen(offer.contract.reward.money)}
                </span>
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
