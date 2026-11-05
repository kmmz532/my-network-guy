// 社員の札と、社員の一覧の中身。ウィンドウ（Window.tsx）の中に出し、タイトルの帯・×・大きさは Windows.tsx が受け持つ。
// 状態（待機中・担当中・研修中）は sim/staff.ts の staffStatus で決める。
import { balance } from 'virtual:game-data';
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import { staffStatus, totalSalary, type StaffStatus } from '../sim/staff';
import { useGameStore } from '../stores/useGameStore';
import { Icon } from './Icon';

const yen = (n: number) => n.toLocaleString('ja-JP');
// 社員の一覧の列の幅（名前・職種と level・月給・状態）
const COLUMNS = 'minmax(0, 0.8fr) minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1.2fr)';

// 状態の文言（担当中は案件の名前を出す）
const statusText = (status: StaffStatus): string => {
  if (status.kind === 'training') return t('ui.staff.status.training', { days: status.days });
  if (status.kind === 'project') {
    return t('ui.staff.status.project', { project: t(`contract.${status.baseId}.title` as LangKey, status.params) });
  }
  return t('ui.staff.status.idle');
};

// ウィンドウのタイトル（社員の名前）
export function StaffTitle({ uid }: { uid: string }) {
  const member = useGameStore((s) => s.staff.find((m) => m.uid === uid));
  if (!member) return null;
  return <b>{t(member.name as LangKey)}</b>;
}

// 社員の札。見た目・名前・職種・level・経験値・月給・資格・状態・口癖と、研修・資格へのボタン
export function StaffBody({ uid, onTraining }: { uid: string; onTraining: () => void }) {
  const state = useGameStore();
  const member = state.staff.find((m) => m.uid === uid);
  if (!member) return null;
  const status = staffStatus(member, state.active, state.clock.minute);
  // 次の level までの経験値（level n から n+1 に上がるのに expPerLevel × n）
  const next = balance.staff.expPerLevel * member.level;
  const ratio = Math.min(1, member.exp / next);
  const label = { color: 'rgba(244, 241, 230, 0.7)', fontSize: 12 } as const;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Icon name={`staff/${member.look}_0`} scale={3} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 'bold', fontSize: 15 }}>{t(member.name as LangKey)}</div>
          <div>{t(`staff.job.${member.job}` as LangKey)}</div>
          <div>{t('ui.staff.level', { level: member.level })}</div>
          <div>{t('ui.hiring.salary', { salary: yen(member.salary) })}</div>
        </div>
      </div>
      <div>
        <div style={label}>{t('ui.staff.card.exp', { exp: member.exp, next })}</div>
        <div style={{ height: 6, marginTop: 2, background: '#1b2f57', border: '1px solid #3b2a33', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${ratio * 100}%`, height: '100%', background: '#ffd866' }} />
        </div>
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 10px', margin: 0 }}>
        <dt style={label}>{t('ui.staff.card.certs')}</dt>
        <dd style={{ margin: 0 }}>
          {member.certs.length > 0 ? member.certs.map((id) => t(`cert.${id}.name` as LangKey)).join('、') : t('ui.staff.card.none')}
        </dd>
        <dt style={label}>{t('ui.staff.card.status')}</dt>
        <dd style={{ margin: 0 }}>{statusText(status)}</dd>
      </dl>
      <div style={{ fontStyle: 'italic', opacity: 0.9 }}>{t(`staff.quirk.${member.quirk}` as LangKey)}</div>
      <div>
        <button style={{ padding: '4px 12px', cursor: 'pointer' }} onClick={onTraining}>
          {t('ui.staff.card.goto')}
        </button>
      </div>
    </div>
  );
}

// 全社員の一覧。1人1行で名前・職種と level・月給・状態を出し、最後に月給の合計。行を押すとその社員の札を開く
export function StaffListBody() {
  const state = useGameStore();
  const openWindow = state.openWindow;
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
              borderRadius: 3,
              cursor: 'pointer',
              font: 'inherit',
              fontSize: 12,
              textAlign: 'left',
            }}
          >
            <span style={{ fontWeight: 'bold' }}>{t(m.name as LangKey)}</span>
            <span>
              {t(`staff.job.${m.job}` as LangKey)} · {t('ui.staff.level', { level: m.level })}
            </span>
            <span>{yen(m.salary)}円</span>
            <span>{statusText(status)}</span>
          </button>
        );
      })}
      <div style={{ textAlign: 'right', fontWeight: 'bold', marginTop: 6 }}>
        {t('ui.staff.list.total', { salary: yen(totalSalary(state.staff)) })}
      </div>
    </div>
  );
}
