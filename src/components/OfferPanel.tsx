import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import { useGameStore } from '../stores/useGameStore';
import { ContractDetail } from './ContractDetail';
import { panelStyle } from './panelStyle';


// 届いている依頼を一覧にする。受注は1件まで。
export function OfferPanel() {
  const offers = useGameStore((s) => s.offers);
  const busy = useGameStore((s) => s.active !== null);
  const accept = useGameStore((s) => s.accept);
  return (
    <section style={panelStyle}>
      <h2 style={{ fontSize: 14, margin: '0 0 6px' }}>{t('ui.offer.title')}</h2>
      {offers.length === 0 && <div>{t('ui.offer.empty')}</div>}
      {offers.map((offer) => (
        <div key={offer.id} style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 'bold' }}>{t(`contract.${offer.baseId}.title` as LangKey, offer.params)}</div>
          <ContractDetail contract={offer.contract} baseId={offer.baseId} params={offer.params} />
          <div>{t('ui.offer.budget', { amount: offer.contract.budget.toLocaleString('ja-JP') })}</div>
          <div>{t('ui.offer.reward', { amount: offer.contract.reward.money.toLocaleString('ja-JP') })}</div>
          <button disabled={busy} onClick={() => accept(offer.id)}>
            {t('ui.accept')}
          </button>
        </div>
      ))}
    </section>
  );
}
