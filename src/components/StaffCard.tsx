import { bonusEnvOf, pcDesksOf } from '../sim/furniture';
// 社員の札と、社員の一覧の中身。ウィンドウ（Window.tsx）の中に出し、タイトルの帯・×・大きさは Windows.tsx が受け持つ。
// 状態（待機中・担当中・研修中）は sim/staff.ts の staffStatus で決める。
import { balance } from 'virtual:game-data';
import { t, tDyn } from '../i18n/t';
import { raiseAmountOf, staffPower, staffStatus, totalSalary, type StaffStatus } from '../sim/staff';
import { backOfficeContributionOf, backOfficeP, hasPcAt, isBackOffice, jobEffect } from '../sim/backOffice';
import { gameEnv, isPcDevice } from '../sim/env';
import { jobEffectText } from './jobEffectText';
import { staffSpriteName } from '../data/schema';
import { useGameStore } from '../stores/useGameStore';
import { Icon } from './Icon';
import { RADIUS } from '../ui/theme';
import { useState } from 'react';
import { secondaryButton } from './Modal';
import { Tooltip } from './Tooltip';
import { retireBlock } from '../sim/retire';

const yen = (n: number) => n.toLocaleString('ja-JP');
// 社員の一覧の列の幅（名前・職種と level・月給・状態）
const COLUMNS = 'minmax(0, 0.8fr) minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1.2fr)';

// 状態の文言（担当中は案件の名前を出す）
const statusText = (status: StaffStatus): string => {
  if (status.kind === 'training') return t('ui.staff.status.training', { days: status.days });
  if (status.kind === 'project') {
    return t('ui.staff.status.project', { project: tDyn(`contract.${status.baseId}.title`, status.params) });
  }
  return t('ui.staff.status.idle');
};

// ウィンドウのタイトル（社員の名前）
export function StaffTitle({ uid }: { uid: string }) {
  const member = useGameStore((s) => s.staff.find((m) => m.uid === uid));
  if (!member) return null;
  return <b style={{ display: 'inline-block', maxWidth: '100%', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tDyn(member.name)}</b>;
}

// 社員の札。見た目・名前・職種・level・経験値・月給・資格・状態・口癖と、研修・資格へのボタン
export function StaffBody({ uid, onTraining }: { uid: string; onTraining: () => void }) {
  const state = useGameStore();
  const member = state.staff.find((m) => m.uid === uid);
  if (!member) return null;
  const status = staffStatus(member, state.active, state.clock.minute);
  const env = bonusEnvOf({ staff: state.staff, office: state.office }, gameEnv);
  const back = isBackOffice(member.job);
  // この社員の内勤の寄与（日勤で研修中でないときだけ効く）。効果は、この社員が加わったときの増分
  const contribution = backOfficeContributionOf(member, state.office, env);
  const effect = back
    ? jobEffect(member.job, member, contribution, backOfficeP(state.staff, member.job, state.office, env) - contribution, balance)
    : member.job === 'dev'
      ? jobEffect(member.job, member, contribution, 0, balance)
      : null;
  // 次の level までの経験値（level n から n+1 に上がるのに expPerLevel × n）
  const next = balance.staff.expPerLevel * member.level;
  const ratio = Math.min(1, member.exp / next);
  const label = { color: 'rgba(244, 241, 230, 0.7)', fontSize: 12 } as const;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Icon name={`staff/${staffSpriteName(member.look)}_0`} scale={3} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 'bold', fontSize: 15 }}>{tDyn(member.name)}</div>
          <div>{tDyn(`staff.job.${member.job}`)}</div>
          <div>
            {t('ui.staff.level', { level: member.level })}
            {member.level >= member.levelCap && <span style={{ marginLeft: 6, color: '#ffd866', fontSize: 12 }}>{t('ui.staff.cap')}</span>}
          </div>
          <div>{t('ui.hiring.salary', { salary: yen(member.salary) })}</div>
        </div>
      </div>
      <div>
        <div style={label}>{t('ui.staff.card.exp', { exp: member.exp, next })}</div>
        <div style={{ height: 6, marginTop: 2, background: '#1b2f57', border: '1px solid #3b2a33', borderRadius: RADIUS.none, overflow: 'hidden' }}>
          <div style={{ width: `${ratio * 100}%`, height: '100%', background: '#ffd866' }} />
        </div>
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 10px', margin: 0 }}>
        <dt style={label}>{t('ui.staff.card.certs')}</dt>
        <dd style={{ margin: 0 }}>
          {member.certs.length > 0 ? member.certs.map((id) => tDyn(`cert.${id}.name`)).join('、') : t('ui.staff.card.none')}
        </dd>
        <dt style={label}>{t('ui.staff.card.status')}</dt>
        <dd style={{ margin: 0 }}>{statusText(status)}</dd>
        {/* 施工力はエンジニア枠の社員。内勤は施工力の代わりに、その社員の効果を出す（システムエンジニアは両方） */}
        {!back && (
          <>
            <dt style={label}>{t('ui.staff.card.power')}</dt>
            <dd style={{ margin: 0 }}>{staffPower(member, undefined, state.office, env).toFixed(2)}</dd>
          </>
        )}
        {(member.job === 'dev' || member.job === 'hr' || member.job === 'accounting') && (
          <>
            <dt style={label}>{t('ui.staff.card.pc')}</dt>
            <dd style={{ margin: 0 }}>{hasPcAt(member, env) ? t('ui.staff.pc.yes') : t('ui.staff.pc.no')}</dd>
          </>
        )}
        {(back || member.job === 'dev') && (
          <>
            <dt style={label}>{t('ui.staff.card.effect')}</dt>
            <dd style={{ margin: 0 }}>{effect && (contribution > 0 || member.job === 'dev') ? jobEffectText(effect) : t('ui.effect.job.none')}</dd>
          </>
        )}
      </dl>
      <div style={{ fontStyle: 'italic', opacity: 0.9 }}>{tDyn(`staff.quirk.${member.quirk}`)}</div>
      <div>
        <button style={{ padding: '4px 12px', cursor: 'pointer' }} onClick={onTraining}>
          {t('ui.staff.card.goto')}
        </button>
      </div>
      <RetireControl uid={uid} />
      <RaiseControl uid={uid} />
    </div>
  );
}

// 昇給（N101）。上限に達した社員だけ押せる。押すと、増える月給を確かめてから上げる
function RaiseControl({ uid }: { uid: string }) {
  const member = useGameStore((s) => s.staff.find((m) => m.uid === uid));
  const raise = useGameStore((s) => s.raiseStaff);
  const [asking, setAsking] = useState(false);
  if (!member) return null;
  // 上限に達していなければ、上限の印だけ出す（昇給は出さない）
  if (member.level < member.levelCap) return null;
  const amount = raiseAmountOf(member, balance);
  if (asking) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>{t('ui.staff.raise.confirm', { amount: amount.toLocaleString('ja-JP') })}</span>
        <button style={secondaryButton} onClick={() => { raise(uid); setAsking(false); }}>
          {t('ui.staff.raise.yes')}
        </button>
        <button style={secondaryButton} onClick={() => setAsking(false)}>
          {t('ui.staff.raise.no')}
        </button>
      </div>
    );
  }
  return (
    <div>
      <button style={secondaryButton} onClick={() => setAsking(true)}>
        {t('ui.staff.raise')}
      </button>
    </div>
  );
}

// 退職を伝える・取り消す（N90）。伝えられないときは、理由をツールチップに出す
function RetireControl({ uid }: { uid: string }) {
  const state = useGameStore();
  const member = state.staff.find((m) => m.uid === uid);
  if (!member) return null;
  if (member.leaving) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>{t('ui.retire.leaving', { months: balance.retire.payMonths })}</span>
        <button style={secondaryButton} onClick={() => state.cancelRetire(uid)}>
          {t('ui.retire.cancel')}
        </button>
      </div>
    );
  }
  const reason = retireBlock(state, uid, balance);
  const button = (
    <button
      style={{ ...secondaryButton, cursor: reason === null ? 'pointer' : 'default', opacity: reason === null ? 1 : 0.5 }}
      disabled={reason !== null}
      onClick={() => state.noticeRetire(uid)}
    >
      {t('ui.retire.notice')}
    </button>
  );
  return reason === null ? button : <Tooltip text={tDyn(`ui.error.${reason}`)}><span style={{ display: 'inline-block' }}>{button}</span></Tooltip>;
}

// 全社員の一覧。1人1行で名前・職種と level・月給・状態を出し、最後に月給の合計。行を押すとその社員の札を開く
export function StaffListBody() {
  const state = useGameStore();
  const openWindow = state.openWindow;
  // 机に PC がない社内の職種（システムエンジニア・人事・経理）は、一覧に印を出す（N102）
  const pcDesks = pcDesksOf(state.office, isPcDevice);
  if (state.staff.length === 0) return <div style={{ opacity: 0.7 }}>{t('ui.staff.list.empty')}</div>;
  const head = { fontSize: 12, opacity: 0.7, padding: '0 6px' } as const;
  return (
    <div>
      <div style={{ ...head, display: 'grid', gridTemplateColumns: COLUMNS, gap: 6, marginBottom: 4 }}>
        <span>{t('ui.staff.list.col.name')}</span>
        <span>{t('ui.staff.list.col.job')}</span>
        <span>{t('ui.staff.list.col.salary')}</span>
        <span>{t('ui.staff.list.col.status')}</span>
      </div>
      {state.staff.map((m) => {
        const status = staffStatus(m, state.active, state.clock.minute);
        return (
          <button
            key={m.uid}
            onClick={() => openWindow('staff', m.uid)}
            style={{
              display: 'grid',
              gridTemplateColumns: COLUMNS,
              gap: 6,
              alignItems: 'center',
              width: '100%',
              padding: '4px 6px',
              marginBottom: 4,
              background: '#25406f',
              color: 'inherit',
              border: '1px solid #3b2a33',
              borderRadius: RADIUS.none,
              cursor: 'pointer',
              font: 'inherit',
              fontSize: 12,
              textAlign: 'left',
            }}
          >
            <span style={{ fontWeight: 'bold' }}>{tDyn(m.name)}</span>
            <span>
              {tDyn(`staff.job.${m.job}`)} · {t('ui.staff.level', { level: m.level })}
            </span>
            <span>{yen(m.salary)}円</span>
            <span>
              {statusText(status)}
              {m.level >= m.levelCap && <span style={{ marginLeft: 4, color: '#ffd866' }}>{t('ui.staff.cap')}</span>}
              {(m.job === 'dev' || m.job === 'hr' || m.job === 'accounting') && !(m.desk !== null && pcDesks.includes(m.desk)) && (
                <span style={{ marginLeft: 4, color: '#ffd866' }}>{t('ui.staff.pc.no.short')}</span>
              )}
            </span>
          </button>
        );
      })}
      <div style={{ textAlign: 'right', fontWeight: 'bold', marginTop: 6 }}>
        {t('ui.staff.list.total', { salary: yen(totalSalary(state.staff, balance.nightPayRate)) })}
      </div>
    </div>
  );
}
