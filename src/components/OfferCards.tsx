// 依頼カード。タイトル1行と、PC台数・予算・報酬のアイコンで表す。受注するときに担当の社員を選ぶ
import { offerNodeName } from './nodeLabel';
import { useEffect, useState } from 'react';
import { balance, devices } from 'virtual:game-data';
import { hasKey, t, tDyn } from '../i18n/t';
import { goalText } from './goalText';
import { gameEnv } from '../sim/env';
import { offerHintOf, useGameStore } from '../stores/useGameStore';
import type { Offer } from '../contracts/template';
import { dangerButton, primaryButton, secondaryButton, usePrimary } from './Modal';
import { delegationReason } from '../sim/project';
import { staffPower } from '../sim/staff';
import { starRangeOf } from '../sim/blindDelegate';
import { Tooltip } from './Tooltip';
import { loadSettings, saveSettings, OFFER_SORTS, type OfferSort } from '../settings/settings';
import { sortOffers } from '../contracts/offers';
import { minutesPerDay, toDate } from '../sim/clock';
import { PixelCheck } from './PixelControls';
import { Icon } from './Icon';
import { RADIUS } from '../ui/theme';
import { CATEGORY } from '../data/categories';
import { Select } from './Select';
import { levelOf } from '../sim/level';
import { isBackOffice } from '../sim/backOffice';

// 依頼の一覧。Enter は一番上の依頼の受注（主のボタン）

// 依頼の一覧の中身（ウィンドウの中に出す。マップの操作は止めない）
export function OfferBody({ onClose }: { onClose: () => void }) {
  const offers = useGameStore((s) => s.offers);
  // 案件の枠がいっぱいのときは受注できない
  const full = useGameStore((s) => s.active.length >= balance.office.projectSlots);
  const accept = useGameStore((s) => s.accept);
  const declineOffer = useGameStore((s) => s.declineOffer);
  const now = useGameStore((s) => s.clock.minute);
  // 並べ方（端末の設定に保存する）
  const [sort, setSortState] = useState<OfferSort>(() => loadSettings().offerSort);
  const setSort = (mode: OfferSort) => {
    setSortState(mode);
    saveSettings({ offerSort: mode });
  };
  const yen = (n: number) => n.toLocaleString('ja-JP');
  const hint = useGameStore(offerHintOf);
  // まとめて届いた件数は、開いたときの値を出し、知らせを消す
  const [burst] = useState(() => useGameStore.getState().offerBurst);
  const clearOfferBurst = useGameStore((s) => s.clearOfferBurst);
  useEffect(() => {
    clearOfferBurst();
  }, [clearOfferBurst]);
  const companyExp = useGameStore((s) => s.companyExp);

  return (
    <div style={{ minWidth: 300 }}>
      <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 8 }}>
        {burst >= 2 && <div style={{ color: '#ffd866' }}>{t('ui.offer.burst', { count: burst })}</div>}
        <div>{t('ui.offer.next', { days: hint.days })}</div>
        {hint.block?.kind === 'level' && (
          <div style={{ color: '#ffd866' }}>{t('ui.offer.blocked.level', { need: hint.block.need, now: levelOf(companyExp, balance) })}</div>
        )}
        {hint.block?.kind === 'fixed' && (
          <div style={{ color: '#ffd866' }}>{t('ui.offer.blocked.fixed', { title: tDyn(`contract.${hint.block.after}.title`) })}</div>
        )}
      </div>
      {offers.length === 0 && <div style={{ opacity: 0.7 }}>…</div>}
      {offers.length > 0 && (
        // 並べ替えは選択ボックスにまとめる（幅を取らない。N61）。スマホでは OS の選択画面が開く
        <Select
          label={t('ui.offer.sort.label')}
          value={sort}
          options={OFFER_SORTS.map((mode) => ({ value: mode, label: t(`ui.offer.sort.${mode}`) }))}
          onChange={(v) => setSort(v as OfferSort)}
          style={{ marginBottom: 8 }}
        />
      )}
      {/* 新しい依頼を上に並べる。件数が多いときは、この中だけスクロールする */}
      <div className="scroll-edge" style={{ maxHeight: 'min(60vh, 520px)', overflowY: 'auto', paddingRight: 4 }}>
        {sortOffers(offers, sort).map((offer, i) => (
          <OfferCard
            key={offer.id}
            offer={offer}
            full={full}
            yen={yen}
            now={now}
            primary={i === 0}
            onAccept={(crew) => accept(offer.id, crew) === null && onClose()}
            onDelegate={(crew) => useGameStore.getState().acceptDelegated(offer.id, crew) === null && onClose()}
            onDelegateBlind={(crew) => useGameStore.getState().delegateBlind(offer.id, crew) === null && onClose()}
            onDecline={() => declineOffer(offer.id)}
          />
        ))}
      </div>
    </div>
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
      {/* 内勤（営業・人事・経理）は担当に出さない */}
      {staff.filter((s) => !isBackOffice(s.job)).map((s) => {
        const unavailable = busy.includes(s.uid) || s.training !== null;
        const power = staffPower(s, undefined, office, bonusEnv);
        return (
          <PixelCheck
            key={s.uid}
            disabled={unavailable}
            checked={selected.includes(s.uid)}
            onChange={(checked) => onChange(checked ? [...selected, s.uid] : selected.filter((u) => u !== s.uid))}
          >
            <span>{tDyn(s.name)}</span>
            <span>{tDyn(`staff.job.${s.job}`)}</span>
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
  now,
  primary,
  onAccept,
  onDelegate,
  onDelegateBlind,
  onDecline,
}: {
  offer: Offer;
  full: boolean;
  yen: (n: number) => string;
  // 今の時刻（分）。届いた日と、受注の期限の残りに使う
  now: number;
  // 定型案件だけ断れる
  onDecline: () => void;
  // 一番上の依頼だけ、Enter で受注する主のボタンになる
  primary: boolean;
  onAccept: (crew: string[]) => void;
  // 社員に任せて受注する（N70）
  onDelegate: (crew: string[]) => void;
  // 型紙なしで任せる（N94）
  onDelegateBlind: (crew: string[]) => void;
}) {
  const staff = useGameStore((s) => s.staff);
  const office = useGameStore((s) => s.office);
  const busy = useGameStore((s) => s.active.flatMap((p) => p.crew));
  const familiarity = useGameStore((s) => s.familiarity);
  // 社員に任せられない理由（任せられるなら null）（N70）
  const delegateReason = delegationReason(familiarity, offer, gameEnv);
  // 断る前の確認（設定で切り替える）
  const [asking, setAsking] = useState(false);
  // 受注の画面を開いたときの担当（空いている社員全員）
  const [crew, setCrew] = useState<string[]>(() =>
    staff.filter((s) => !busy.includes(s.uid) && s.training === null && !isBackOffice(s.job)).map((s) => s.uid),
  );
  // 予想の★の範囲（今の担当で）。担当が決まると変わる
  const blindRange = (() => {
    const jobs = offer.contract.jobs ?? [];
    const members = staff.filter((m) => crew.includes(m.uid));
    const bonusEnv = { defs: gameEnv.furniture ?? {}, balance, staffUids: staff.map((m) => m.uid) };
    const power = members.reduce((sum, m) => sum + staffPower(m, jobs, office, bonusEnv), 0);
    const pcCount = offer.contract.placed.filter((p) => devices[p.device as keyof typeof devices]?.category === CATEGORY.pc).length;
    const match = jobs.length === 0 || members.length === 0 ? 1 : members.filter((m) => jobs.includes(m.job)).length / members.length;
    const [min, max] = starRangeOf(power, pcCount, match, balance);
    return min === max ? `★${min}` : `★${min}〜${max}`;
  })();
  const canAccept = !full && crew.length > 0;
  usePrimary(primary ? () => canAccept && onAccept(crew) : undefined);
  const hosts = offer.contract.placed.filter((p) => {
    const c = devices[p.device as keyof typeof devices]?.category;
    return c === CATEGORY.pc || c === CATEGORY.server;
  }).length;
  return (
    <div style={{ background: '#25406f', borderRadius: RADIUS.none, padding: 10, marginBottom: 8 }}>
      <div style={{ fontWeight: 'bold', marginBottom: 4 }}>
        {offer.contract.inhouse && (
          <span style={{ background: '#5aa860', borderRadius: RADIUS.none, padding: '0 6px', marginRight: 6, fontSize: 12 }}>
            {t('ui.offer.inhouse')}
          </span>
        )}
        {tDyn(`contract.${offer.baseId}.title`, offer.params)}
        {/* 営業が持ってきた依頼の印（N81） */}
        {(offer as Offer & { fromSales?: true }).fromSales && <span style={{ marginLeft: 6, fontSize: 12, color: '#ffd866' }}>{t('ui.offer.fromSales')}</span>}
      </div>
      <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 6 }}>
        {tDyn(`contract.${offer.baseId}.story`, offer.params)}
      </div>
      {offer.arrivedMinute !== undefined && (
        <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>
          {t('ui.offer.arrived', { month: toDate(offer.arrivedMinute, balance).month, day: toDate(offer.arrivedMinute, balance).day })}
        </div>
      )}
      {(offer.contract.jobs?.length ?? 0) > 0 && (
        <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 4 }}>
          {t('ui.offer.jobs', { jobs: (offer.contract.jobs ?? []).map((j) => tDyn(`staff.job.${j}`)).join('・') })}
        </div>
      )}
      {offer.contract.goals.map((goal, i) => (
        <div key={i} style={{ fontSize: 12, opacity: 0.85 }}>
          ・{goalText(goal, (id) => offerNodeName(offer, id))}
        </div>
      ))}
      {hasKey(`contract.${offer.baseId}.hint`) && (
        <div style={{ fontSize: 12, color: '#ffd866', marginTop: 4 }}>
          {t('ui.task.hint', { text: tDyn(`contract.${offer.baseId}.hint`) })}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'center' }}>
        <span>
          <Icon name="icon/pc_count" /> ×{hosts}
        </span>
        <span>
          <Icon name="icon/budget" /> {yen(offer.contract.budget)}
        </span>
        {offer.contract.deadlineDays !== undefined && <span style={{ whiteSpace: 'nowrap' }}>{t('ui.offer.deadline', { days: offer.contract.deadlineDays })}</span>}
        {offer.expiresMinute !== undefined && (
          <span style={{ color: '#ffd866' }}>{t('ui.offer.expires', { days: Math.max(0, Math.ceil((offer.expiresMinute - now) / minutesPerDay)) })}</span>
        )}
        <span style={{ color: '#ffd866' }}>
          <Icon name="icon/money" /> {yen(offer.contract.reward.money)}
        </span>
        {/* 断る・受注・任せる。ボタンは1つの並びで折り返さない（スマホで受注が次の行に落ちないように） */}
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexShrink: 0, alignItems: 'center' }}>
          {asking ? (
            <>
              <span style={{ whiteSpace: 'nowrap' }}>{t('ui.offer.decline.confirm')}</span>
              <button style={{ ...dangerButton, whiteSpace: 'nowrap' }} onClick={onDecline}>
                {t('ui.offer.decline.yes')}
              </button>
              <button style={{ ...secondaryButton, whiteSpace: 'nowrap' }} onClick={() => setAsking(false)}>
                {t('ui.offer.decline.no')}
              </button>
            </>
          ) : (
            <>
              {offer.kind === 'template' && (
                <button
                  style={{ fontFamily: 'inherit', cursor: 'pointer', background: 'transparent', color: '#f4f1e6', border: '1px solid #3b2a33', borderRadius: RADIUS.none, padding: '4px 8px', whiteSpace: 'nowrap' }}
                  onClick={() => (loadSettings().confirmDecline ? setAsking(true) : onDecline())}
                >
                  {t('ui.offer.decline')}
                </button>
              )}
              <button style={{ ...primaryButton, whiteSpace: 'nowrap' }} disabled={!canAccept} onClick={() => onAccept(crew)}>
                {t('ui.accept')}
              </button>
              {delegateReason === null && (
                <button style={{ ...secondaryButton, whiteSpace: 'nowrap' }} disabled={!canAccept} onClick={() => onDelegate(crew)}>
                  {t('ui.delegate.button')}
                </button>
              )}
              {/* 型紙が合わない依頼は、結果を乱数で決めて任せる（N94）。予想の★を、押す前に出す */}
              {(delegateReason === 'delegate.fit' || delegateReason === 'delegate.blueprint') && (
                <Tooltip text={t('ui.delegate.stars', { range: blindRange })}>
                  <button style={{ ...secondaryButton, whiteSpace: 'nowrap' }} disabled={!canAccept} onClick={() => onDelegateBlind(crew)}>
                    {t('ui.delegate.blind')}
                  </button>
                </Tooltip>
              )}
            </>
          )}
        </div>
      </div>
      <CrewPicker selected={crew} onChange={setCrew} />
    </div>
  );
}
