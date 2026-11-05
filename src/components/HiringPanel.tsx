// 採用と社員の画面。採用は候補の社員から選ぶ（席が足りなければ採用できない）。社員のタブで、研修と資格の受験を行う
import { useState } from 'react';
import { balance, certs, furniture, training } from 'virtual:game-data';
import type { FurnitureId } from '../generated/ids';
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import { seatCount } from '../sim/furniture';
import { examPassRate } from '../sim/training';
import { useGameStore } from '../stores/useGameStore';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';
import { Modal, primaryButton } from './Modal';

const tabStyle = (on: boolean) => ({
  padding: '2px 10px',
  cursor: 'pointer',
  background: on ? '#f4f1e6' : 'transparent',
  color: on ? '#2f4f8f' : '#f4f1e6',
  border: '1px solid #f4f1e6',
  borderRadius: 4,
});

export type HiringTab = 'hiring' | 'staff';

// tab は開くときのタブ。社員の札の「研修・資格へ」から開くときは staff にする
export function HiringPanel({ tab, onTab, onClose }: { tab: HiringTab; onTab: (tab: HiringTab) => void; onClose: () => void }) {
  const [message, setMessage] = useState('');
  // Enter は閉じる（主のボタン）
  return (
    <Modal onClose={onClose} primary={onClose} boxStyle={{ width: 'min(420px, calc(100% - 32px))' }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <button style={tabStyle(tab === 'hiring')} onClick={() => onTab('hiring')}>
          {t('ui.hiring.tab.hiring')}
        </button>
        <button style={tabStyle(tab === 'staff')} onClick={() => onTab('staff')}>
          {t('ui.hiring.tab.staff')}
        </button>
      </div>
      <div style={{ maxHeight: 'min(60vh, 480px)', overflowY: 'auto' }}>
        {tab === 'hiring' ? <Candidates onMessage={setMessage} /> : <StaffList onMessage={setMessage} />}
      </div>
      {message && <div style={{ color: '#ffd866', fontSize: 13, marginTop: 6 }}>{message}</div>}
      <button style={{ ...primaryButton, display: 'block', marginTop: 8, marginLeft: 'auto' }} onClick={onClose}>
        {t('ui.panel.close')}
      </button>
    </Modal>
  );
}

const reasonText = (reason: string) => t(`ui.error.${reason}` as LangKey);

// 採用の候補
function Candidates({ onMessage }: { onMessage: (m: string) => void }) {
  const candidates = useGameStore((s) => s.candidates);
  const staff = useGameStore((s) => s.staff.length);
  const office = useGameStore((s) => s.office);
  const hire = useGameStore((s) => s.hire);
  const seats = seatCount(office, (id) => furniture[id as FurnitureId]?.seat === true);
  const full = staff >= seats;
  const yen = (n: number) => n.toLocaleString('ja-JP');
  return (
    <>
      {candidates.length === 0 && <div style={{ opacity: 0.7 }}>{t('ui.hiring.none')}</div>}
      {candidates.map((c) => (
        <div
          key={c.uid}
          style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#25406f', borderRadius: 4, padding: 8, marginBottom: 6 }}
        >
          <Icon name={`staff/${c.look}_0`} scale={2} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 'bold' }}>{t(c.name as LangKey)}</div>
            <div style={{ fontSize: 12 }}>
              {t(`staff.job.${c.job}` as LangKey)} · {t('ui.staff.level', { level: c.level })}
            </div>
            <div style={{ fontSize: 12 }}>{t('ui.hiring.salary', { salary: yen(c.salary) })}</div>
          </div>
          <button
            style={{ padding: '4px 12px', cursor: 'pointer' }}
            disabled={full}
            onClick={() => {
              const reason = hire(c.uid);
              onMessage(reason ? reasonText(reason) : '');
            }}
          >
            {t('ui.hiring.hire')}
          </button>
        </div>
      ))}
      {full && <div style={{ color: '#ffd866', fontSize: 13 }}>{t('ui.error.seat')}</div>}
    </>
  );
}

// 社員の一覧。研修と資格の受験を行う
function StaffList({ onMessage }: { onMessage: (m: string) => void }) {
  const staff = useGameStore((s) => s.staff);
  const money = useGameStore((s) => s.clock.money);
  const busy = useGameStore((s) => s.active.flatMap((p) => p.crew));
  const startTraining = useGameStore((s) => s.startTraining);
  const takeExam = useGameStore((s) => s.takeExam);
  const yen = (n: number) => n.toLocaleString('ja-JP');
  const courses = Object.values(training);
  const examList = Object.values(certs);
  return (
    <>
      {staff.map((s) => {
        const onProject = busy.includes(s.uid);
        const locked = s.training !== null || onProject;
        return (
          <div key={s.uid} style={{ background: '#25406f', borderRadius: 4, padding: 8, marginBottom: 6 }}>
            <div style={{ fontWeight: 'bold' }}>
              {t(s.name as LangKey)}{' '}
              <span style={{ fontWeight: 'normal', fontSize: 12 }}>
                {t(`staff.job.${s.job}` as LangKey)} · {t('ui.staff.level', { level: s.level })}
              </span>
            </div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>
              {s.training ? t('ui.training.busy') : onProject ? t('ui.training.onProject') : ''}
              {s.certs.length > 0 && ` · ${s.certs.map((id) => t(`cert.${id}.name` as LangKey)).join('、')}`}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
              {courses.map((c) => (
                <Tooltip text={t('ui.training.info', { cost: yen(c.cost), days: c.days, exp: c.exp })} key={c.id}><button aria-label={t('ui.training.info', { cost: yen(c.cost), days: c.days, exp: c.exp })} style={{ padding: '2px 8px', cursor: 'pointer', fontSize: 12 }}
                  disabled={locked || money < c.cost}
                  
                  onClick={() => {
                    const reason = startTraining(s.uid, c.id);
                    onMessage(reason ? reasonText(reason) : t('ui.training.started'));
                  }}
                >
                  {t(`training.${c.id}.name` as LangKey)}（{yen(c.cost)}円・{c.days}日）
                </button></Tooltip>
              ))}
              {examList
                .filter((c) => c.job === s.job && s.level >= c.minLevel && !s.certs.includes(c.id))
                .map((c) => (
                  <Tooltip text={t('ui.exam.info', { rate: Math.round(examPassRate(s.level, c.minLevel, balance) * 100) })} key={c.id}><button aria-label={t('ui.exam.info', { rate: Math.round(examPassRate(s.level, c.minLevel, balance) * 100) })} style={{ padding: '2px 8px', cursor: 'pointer', fontSize: 12 }}
                    disabled={locked || money < c.fee}
                    
                    onClick={() => {
                      const reason = takeExam(s.uid, c.id);
                      onMessage(reason ? reasonText(reason) : t('ui.exam.done'));
                    }}
                  >
                    {t('ui.exam.start')}：{t(`cert.${c.id}.name` as LangKey)}
                  </button></Tooltip>
                ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
