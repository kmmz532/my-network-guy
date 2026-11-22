import { bonusEnvOf } from '../sim/furniture';
// 依頼カード。タイトル1行と、PC台数・予算・報酬のアイコンで表す。受注するときに担当の社員を選ぶ
import { offerNodeName } from './nodeLabel';
import { useEffect, useState } from 'react';
import { balance } from 'virtual:game-data';
import { hasKey, t, tDyn } from '../i18n/t';
import { goalText } from './goalText';
import { gameEnv, isPcDevice } from '../sim/env';
import { rewardWithMul } from '../sim/project';
import { offerHintOf, rewardMulOf, useGameStore } from '../stores/useGameStore';
import type { Offer } from '../contracts/template';
import { usePrimary } from './Modal';
import { delegateModeOf } from '../sim/project';
import { staffPower } from '../sim/staff';
import { starRangeOf } from '../sim/blindDelegate';
import { Tooltip } from './Tooltip';
import { loadSettings, saveSettings, OFFER_SORTS, type OfferSort } from '../settings/settings';
import { sortOffers } from '../contracts/offers';
import { minutesPerDay, toDate } from '../sim/clock';
import { Checkbox } from './ui/Checkbox';
import { Icon } from './Icon';
import { CATEGORY, isPcCategory } from '../data/categories';
import { Select } from './ui/Select';
import { levelOf } from '../sim/level';
import { isBackOffice } from '../sim/backOffice';
import { crewBlock } from '../sim/crew';
import { usePhone } from '../ui/usePhone';
import { deviceCategory } from '../registry/query';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Text } from './ui/Text';
import { Badge } from './ui/Badge';

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
      <Text tone="soft" size="sm" layout={{ marginBottom: 8 }}>
        {burst >= 2 && <Text tone="warn" size="sm">{t('ui.offer.burst', { count: burst })}</Text>}
        <div>{t('ui.offer.next', { days: hint.days })}</div>
        {hint.block?.kind === 'level' && (
          <Text tone="warn" size="sm">{t('ui.offer.blocked.level', { need: hint.block.need, now: levelOf(companyExp, balance) })}</Text>
        )}
        {hint.block?.kind === 'fixed' && (
          <Text tone="warn" size="sm">{t('ui.offer.blocked.fixed', { title: tDyn(`contract.${hint.block.after}.title`) })}</Text>
        )}
      </Text>
      {offers.length === 0 && <Text tone="sub">…</Text>}
      {offers.length > 0 && (
        // 並べ替えは選択ボックスにまとめる（幅を取らない。N61）。スマホでは OS の選択画面が開く
        <Select
          label={t('ui.offer.sort.label')}
          value={sort}
          options={OFFER_SORTS.map((mode) => ({ value: mode, label: t(`ui.offer.sort.${mode}`) }))}
          onChange={(v) => setSort(v as OfferSort)}
          layout={{ marginBottom: 8 }}
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
            // 任せる依頼は、押したあとも依頼の窓を閉じない（施工は時間がかかり、終わったら通知で伝える）
            onDelegate={(crew) => useGameStore.getState().acceptDelegated(offer.id, crew)}
            onDelegateBlind={(crew) => useGameStore.getState().delegateBlind(offer.id, crew)}
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
  const active = useGameStore((s) => s.active);
  const bonusEnv = bonusEnvOf({ staff: staff, office: office }, gameEnv);
  return (
    <Text size="sm" layout={{ marginTop: 6 }}>
      <Tooltip text={t('ui.offer.crew.tip')}>
        <div style={{ marginBottom: 2, width: 'fit-content' }}>{t('ui.offer.crew')}</div>
      </Tooltip>
      {/* 内勤（営業・人事・経理）は担当に出さない */}
      {staff.filter((s) => !isBackOffice(s.job)).map((s) => {
        const unavailable = crewBlock({ active }, s) !== null;
        const power = staffPower(s, undefined, office, bonusEnv);
        return (
          <Checkbox
            box="pixel"
            key={s.uid}
            disabled={unavailable}
            checked={selected.includes(s.uid)}
            onChange={(checked) => onChange(checked ? [...selected, s.uid] : selected.filter((u) => u !== s.uid))}
          >
            <span>{tDyn(s.name)}</span>
            <span>{tDyn(`staff.job.${s.job}`)}</span>
            <span>{t('ui.staff.level', { level: s.level })}</span>
            <span>{t('ui.staff.power', { power: power.toFixed(2) })}</span>
          </Checkbox>
        );
      })}
    </Text>
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
  const active = useGameStore((s) => s.active);
  const familiarity = useGameStore((s) => s.familiarity);
  const rewardMul = useGameStore((s) => rewardMulOf(s));
  // 任せる依頼の出し方（型紙で・型紙なし・任せられない）（N70・N94）
  const delegateMode = delegateModeOf(familiarity, offer);
  // 断る前の確認（設定で切り替える）
  const [asking, setAsking] = useState(false);
  // 受注の画面を開いたときの担当（空いている社員全員）
  const [crew, setCrew] = useState<string[]>(() =>
    staff.filter((s) => crewBlock({ active }, s) === null).map((s) => s.uid),
  );
  // 予想の★の範囲（今の担当で）。担当が決まると変わる
  const blindRange = (() => {
    const jobs = offer.contract.jobs ?? [];
    const members = staff.filter((m) => crew.includes(m.uid));
    const bonusEnv = bonusEnvOf({ staff: staff, office: office }, gameEnv);
    const power = members.reduce((sum, m) => sum + staffPower(m, jobs, office, bonusEnv), 0);
    const pcCount = offer.contract.placed.filter((p) => isPcDevice(p.device)).length;
    const match = jobs.length === 0 || members.length === 0 ? 1 : members.filter((m) => jobs.includes(m.job)).length / members.length;
    const [min, max] = starRangeOf(power, pcCount, match, balance);
    return min === max ? `★${min}` : `★${min}〜${max}`;
  })();
  const canAccept = !full && crew.length > 0;
  // Enter の既定: 断る確認の中では「やめる」、それ以外は一番上の依頼の受注（N74）
  usePrimary(asking ? () => setAsking(false) : primary ? () => canAccept && onAccept(crew) : undefined);
  const hosts = offer.contract.placed.filter((p) => {
    const c = deviceCategory(p.device);
    return isPcCategory(c) || c === CATEGORY.server;
  }).length;
  // スマホでは、ボタンの列を情報の下の独立した行にする（受注を広く、断るを狭く・B15）
  const phone = usePhone();
  return (
    <Card layout={{ marginBottom: 8 }}>
      <Text bold layout={{ marginBottom: 4 }}>
        {offer.contract.inhouse && (
          <Badge color="var(--fg)" fill="var(--bg-confirm)" border="var(--bg-confirm)" layout={{ marginRight: 6 }}>
            {t('ui.offer.inhouse')}
          </Badge>
        )}
        {offer.proposal === true && (
          <Badge color="var(--fg)" fill="var(--bg-confirm)" border="var(--bg-confirm)" layout={{ marginRight: 6 }}>
            {t('ui.offer.proposal')}
          </Badge>
        )}
        {tDyn(`contract.${offer.baseId}.title`, offer.params)}
        {/* 営業が持ってきた依頼の印（N81） */}
        {(offer as Offer & { fromSales?: true }).fromSales && <Text as="span" tone="warn" size="s" layout={{ marginLeft: 6 }}>{t('ui.offer.fromSales')}</Text>}
      </Text>
      <Text tone="soft" size="sm" layout={{ marginBottom: 6 }}>
        {offer.proposal === true && offer.topic !== undefined ? t('ui.offer.proposalStory', { name: tDyn(`achievement.${offer.topic}`) }) : tDyn(`contract.${offer.baseId}.story`, offer.params)}
      </Text>
      {offer.arrivedMinute !== undefined && (
        <Text tone="sub" size="s" layout={{ marginBottom: 4 }}>
          {t('ui.offer.arrived', { month: toDate(offer.arrivedMinute, balance).month, day: toDate(offer.arrivedMinute, balance).day })}
        </Text>
      )}
      {(offer.contract.jobs?.length ?? 0) > 0 && (
        <Text tone="soft" size="s" layout={{ marginBottom: 4 }}>
          {t('ui.offer.jobs', { jobs: (offer.contract.jobs ?? []).map((j) => tDyn(`staff.job.${j}`)).join('・') })}
        </Text>
      )}
      {offer.contract.goals.map((goal, i) => (
        <Text key={i} tone="soft" size="s">
          ・{goalText(goal, (id) => offerNodeName(offer, id))}
        </Text>
      ))}
      {hasKey(`contract.${offer.baseId}.hint`) && (
        <Text tone="warn" size="s" layout={{ marginTop: 4 }}>
          {t('ui.task.hint', { text: tDyn(`contract.${offer.baseId}.hint`) })}
        </Text>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'center' }}>
        <span>
          <Icon name="icon/pc_count" /> ×{hosts}
        </span>
        <span>
          <Icon name="icon/budget" /> {yen(offer.contract.budget)}
        </span>
        {offer.contract.deadlineDays !== undefined && <Tooltip text={t('ui.offer.deadline.tip')}><span style={{ whiteSpace: 'nowrap' }}>{t('ui.offer.deadline', { days: offer.contract.deadlineDays })}</span></Tooltip>}
        {offer.expiresMinute !== undefined && (
          <Text as="span" tone="warn">{t('ui.offer.expires', { days: Math.max(0, Math.ceil((offer.expiresMinute - now) / minutesPerDay)) })}</Text>
        )}
        <Text as="span" tone="warn">
          <Icon name="icon/money" /> {yen(rewardWithMul(offer.contract.reward.money, rewardMul))}
        </Text>
        {/* 断る・任せる・受注を1つのまとまりにして右寄せにする。折り返さない（スマホで受注が次の行に落ちないように・N109b） */}
        <div style={phone ? { display: 'flex', flexWrap: 'nowrap', gap: 6, width: '100%', alignItems: 'center', justifyContent: 'flex-end' } : { display: 'flex', gap: 6, marginLeft: 'auto', flexShrink: 0, alignItems: 'center' }}>
          {asking ? (
            <>
              <span style={{ whiteSpace: 'nowrap' }}>{t('ui.offer.decline.confirm')}</span>
              <Button variant="danger" onClick={onDecline}>
                {t('ui.offer.decline.yes')}
              </Button>
              <Button variant="secondary" onClick={() => setAsking(false)}>
                {t('ui.offer.decline.no')}
              </Button>
              {/* 次から確認しない（設定と同じ値を変える。この依頼はまだ断らない） */}
              <Button variant="secondary" onClick={() => {
                  saveSettings({ confirmDecline: false });
                  setAsking(false);
                }}>
                {t('ui.offer.decline.never')}
              </Button>
            </>
          ) : (
            <>
              {offer.kind === 'template' && (
                <Button
                  // 断るは危ないボタンの見た目で区別する。確認があるため、位置は離さない（N109b）
                  variant="danger"
                  layout={{ marginRight: 6, ...(phone ? { minHeight: 44 } : {}) }}
                  onClick={() => (loadSettings().confirmDecline ? setAsking(true) : onDecline())}
                >
                  {t('ui.offer.decline')}
                </Button>
              )}
              {delegateMode === 'blueprint' && (
                <Button variant="secondary" disabled={!canAccept} onClick={() => onDelegate(crew)}>
                  {t('ui.delegate.button')}
                </Button>
              )}
              {/* 型紙が合わない依頼は、結果を乱数で決めて任せる（N94）。予想の★を、押す前に出す */}
              {delegateMode === 'blind' && (
                <Tooltip text={t('ui.delegate.stars', { range: blindRange })}>
                  <Button variant="secondary" disabled={!canAccept} onClick={() => onDelegateBlind(crew)}>
                    {t('ui.delegate.blind')}
                  </Button>
                </Tooltip>
              )}
              <Button variant="primary" guide="accept" layout={phone ? { minWidth: 96, minHeight: 44 } : undefined} disabled={!canAccept} onClick={() => onAccept(crew)}>
                {t('ui.accept')}
              </Button>
            </>
          )}
        </div>
      </div>
      <CrewPicker selected={crew} onChange={setCrew} />
    </Card>
  );
}
