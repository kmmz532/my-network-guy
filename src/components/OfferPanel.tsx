import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import { useGameStore } from '../stores/useGameStore';

const panelStyle = {
  background: 'rgba(47, 79, 143, 0.9)',
  color: '#f4f1e6',
  padding: 12,
  borderRadius: 4,
  width: 280,
  fontSize: 14,
} as const;

// 届いている依頼を一覧にする（受注は案件の流れの実装で追加する）
export function OfferPanel() {
  const offers = useGameStore((s) => s.offers);
  return (
    <section style={panelStyle}>
      <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>{t('ui.offer.title')}</h2>
      {offers.length === 0 && <div>{t('ui.offer.empty')}</div>}
      {offers.map((offer) => (
        <div key={offer.id} style={{ marginBottom: 10 }}>
          <div>{t(`contract.${offer.baseId}.title` as LangKey, offer.params)}</div>
          <div>{t('ui.offer.budget', { amount: offer.contract.budget.toLocaleString('ja-JP') })}</div>
          <div>{t('ui.offer.reward', { amount: offer.contract.reward.money.toLocaleString('ja-JP') })}</div>
        </div>
      ))}
    </section>
  );
}
