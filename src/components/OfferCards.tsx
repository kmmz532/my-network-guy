// 依頼カード。タイトル1行と、PC台数・予算・報酬のアイコンで表す。受注するときに担当の社員を選ぶ
import { offerNodeName } from './nodeLabel';
import { useEffect, useState } from 'react';
import { balance, devices } from 'virtual:game-data';
import type { LangKey } from '../generated/lang-keys';
import { hasKey, t } from '../i18n/t';
import { goalText } from './goalText';
import { gameEnv } from '../sim/env';
import { staffPower } from '../sim/staff';
import { offerHintOf, useGameStore } from '../stores/useGameStore';
import type { Offer } from '../contracts/template';
import { Modal, primaryButton, usePrimary } from './Modal';
import { PixelCheck } from './PixelControls';
import { Icon } from './Icon';
import { RADIUS } from '../ui/theme';

// 依頼の一覧。Enter は一番上の依頼の受注（主のボタン）
// 主でない受注ボタン。主のボタンと同じ寸法・縁で、背景だけ明るい青にする（押せないときは薄く出る）
const acceptButton = {
  ...primaryButton,
  background: '#3a7bd0',
  color: '#f4f1e6',
  fontFamily: 'inherit',
} as const;

export function OfferCards({ onClose }: { onClose: () => void }) {
  const offers = useGameStore((s) => s.offers);
  // 案件の枠がいっぱいのときは受注できない
  const full = useGameStore((s) => s.active.length >= balance.office.projectSlots);
  const accept = useGameStore((s) => s.accept);
  const yen = (n: number) => n.toLocaleString('ja-JP');
  const hint = useGameStore(offerHintOf);
  // まとめて届いた件数は、開いたときの値を出し、知らせを消す
  const [burst] = useState(() => useGameStore.getState().offerBurst);
  const clearOfferBurst = useGameStore((s) => s.clearOfferBurst);
  useEffect(() => {
    clearOfferBurst();
  }, [clearOfferBurst]);
  const reputation = useGameStore((s) => s.reputation);

  return (
    <Modal onClose={onClose} boxStyle={{ minWidth: 320 }}>
      <div style={{ marginBottom: 8 }}>
        <Icon name="icon/mail" />
      </div>
      <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 8 }}>
        {burst >= 2 && <div style={{ color: '#ffd866' }}>{t('ui.offer.burst', { count: burst })}</div>}
        <div>{t('ui.offer.next', { days: hint.days })}</div>
        {hint.block?.kind === 'full' && <div style={{ color: '#ffd866' }}>{t('ui.offer.blocked.full', { max: hint.block.max })}</div>}
        {hint.block?.kind === 'reputation' && (
          <div style={{ color: '#ffd866' }}>{t('ui.offer.blocked.reputation', { need: hint.block.need, now: reputation })}</div>
        )}
        {hint.block?.kind === 'fixed' && (
          <div style={{ color: '#ffd866' }}>{t('ui.offer.blocked.fixed', { title: t(`contract.${hint.block.after}.title` as LangKey) })}</div>
        )}
      </div>
      {offers.length === 0 && <div style={{ opacity: 0.7 }}>…</div>}
      {/* 新しい依頼を上に並べる。件数が多いときは、この中だけスクロールする */}
      <div style={{ maxHeight: 'min(60vh, 520px)', overflowY: 'auto', paddingRight: 4 }}>
        {[...offers].reverse().map((offer, i) => (
          <OfferCard
            key={offer.id}
            offer={offer}
            full={full}
            yen={yen}
            primary={i === 0}
            onAccept={(crew) => accept(offer.id, crew) === null && onClose()}
          />
        ))}
      </div>
    </Modal>
  );
}

// 担当の社員の一覧。初期値は、ほかの案件の担当でも研修中でもない社員全員
function CrewPicker({ selected, onChange }: { selected: string[]; onChange: (crew: string[]) => void }) {
  const staff = useGameStore((s) => s.staff);
  const office = useGameStore((s) => s.office);
  const busy = useGameStore((s) => s.active.flatMap((p) => p.crew));
  const bonusEnv = { defs: gameEnv.furniture ?? {}, balance, staffUids: staff.map((s) => s.uid) };
  return (
    <div style={{ marginTop: 6, fontSize: 13 }}>
      <div style={{ marginBottom: 2 }}>{t('ui.offer.crew')}</div>
      {staff.map((s) => {
        const unavailable = busy.includes(s.uid) || s.training !== null;
        const power = staffPower(s, undefined, office, bonusEnv);
        return (
          <PixelCheck
            key={s.uid}
            disabled={unavailable}
            checked={selected.includes(s.uid)}
            onChange={(checked) => onChange(checked ? [...selected, s.uid] : selected.filter((u) => u !== s.uid))}
          >
            <span>{t(s.name as LangKey)}</span>
            <span>{t(`staff.job.${s.job}` as LangKey)}</span>
            <span>{t('ui.staff.level', { level: s.level })}</span>
            <span>{t('ui.staff.power', { power: power.toFixed(2) })}</span>
          </PixelCheck>
        );
      })}
    </div>
  );
}

function OfferCard({
  offer,
  full,
  yen,
  primary,
  onAccept,
}: {
  offer: Offer;
  full: boolean;
  yen: (n: number) => string;
  // 一番上の依頼だけ、Enter で受注する主のボタンになる
  primary: boolean;
  onAccept: (crew: string[]) => void;
}) {
  const staff = useGameStore((s) => s.staff);
  const busy = useGameStore((s) => s.active.flatMap((p) => p.crew));
  // 受注の画面を開いたときの担当（空いている社員全員）
  const [crew, setCrew] = useState<string[]>(() =>
    staff.filter((s) => !busy.includes(s.uid) && s.training === null).map((s) => s.uid),
  );
  const canAccept = !full && crew.length > 0;
  usePrimary(primary ? () => canAccept && onAccept(crew) : undefined);
  const hosts = offer.contract.placed.filter((p) => {
    const c = devices[p.device as keyof typeof devices]?.category;
    return c === 'pc' || c === 'server';
  }).length;
  return (
    <div style={{ background: '#25406f', borderRadius: RADIUS.none, padding: 10, marginBottom: 8 }}>
      <div style={{ fontWeight: 'bold', marginBottom: 4 }}>
        {offer.contract.inhouse && (
          <span style={{ background: '#5aa860', borderRadius: RADIUS.none, padding: '0 6px', marginRight: 6, fontSize: 12 }}>
            {t('ui.offer.inhouse')}
          </span>
        )}
        {t(`contract.${offer.baseId}.title` as LangKey, offer.params)}
      </div>
      <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 6 }}>
        {t(`contract.${offer.baseId}.story` as LangKey, offer.params)}
      </div>
      {(offer.contract.jobs?.length ?? 0) > 0 && (
        <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 4 }}>
          {t('ui.offer.jobs', { jobs: (offer.contract.jobs ?? []).map((j) => t(`staff.job.${j}` as LangKey)).join('・') })}
        </div>
      )}
      {offer.contract.goals.map((goal, i) => (
        <div key={i} style={{ fontSize: 12, opacity: 0.85 }}>
          ・{goalText(goal, (id) => offerNodeName(offer, id))}
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
        {offer.contract.deadlineDays !== undefined && <span>{t('ui.offer.deadline', { days: offer.contract.deadlineDays })}</span>}
        <span style={{ color: '#ffd866' }}>
          <Icon name="icon/money" /> {yen(offer.contract.reward.money)}
        </span>
        <button
          style={primary ? { ...primaryButton, marginLeft: 'auto' } : { ...acceptButton, marginLeft: 'auto' }}
          disabled={!canAccept}
          onClick={() => onAccept(crew)}
        >
          {t('ui.accept')}
        </button>
      </div>
      <CrewPicker selected={crew} onChange={setCrew} />
    </div>
  );
}
