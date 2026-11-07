// 採用と社員の画面。採用は候補の社員から選ぶ（席が足りなければ採用できない）。社員のタブで、研修と資格の受験を行う
import { useState } from 'react';
import { balance, certs, furniture, training } from 'virtual:game-data';
import type { FurnitureId } from '../generated/ids';
import { staffSpriteName } from '../data/schema';
import { t, tDyn } from '../i18n/t';
import { bonusEnvOf, freeDesks } from '../sim/furniture';
import { busyStaff } from '../sim/crew';
import { backOfficeP, isBackOffice, jobEffect } from '../sim/backOffice';
import { jobEffectText } from './jobEffectText';
import { gameEnv, isPcDevice } from '../sim/env';
import { totalSalary, unlockedJobsOf } from '../sim/staff';
import { levelOf } from '../sim/level';
import { examPassRate } from '../sim/training';
import { useGameStore } from '../stores/useGameStore';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';
import { Modal, primaryButton, secondaryButton } from './Modal';
import { Tabs, TAB_COLORS, tabPanelStyle } from './Tabs';
import { RADIUS } from '../ui/theme';
import { Select } from './Select';

export type HiringTab = 'hiring' | 'staff';

// tab は開くときのタブ。社員の札の「研修・資格へ」から開くときは staff にする
export function HiringPanel({ tab, onTab, onClose }: { tab: HiringTab; onTab: (tab: HiringTab) => void; onClose: () => void }) {
  const [message, setMessage] = useState('');
  // Enter は閉じる（主のボタン）
  return (
    <Modal onClose={onClose} primary={onClose} boxStyle={{ width: 'min(420px, calc(100% - 32px))' }}>
      <Tabs
        items={[
          { id: 'hiring', label: t('ui.hiring.tab.hiring') },
          { id: 'staff', label: t('ui.hiring.tab.staff') },
        ]}
        selected={tab}
        onSelect={onTab}
        colors={TAB_COLORS.window}
      />
      <div style={tabPanelStyle(TAB_COLORS.window.selected)}>
        <div style={{ maxHeight: 'min(60vh, 480px)', overflowY: 'auto' }}>
          {tab === 'hiring' ? <Candidates onMessage={setMessage} /> : <StaffList onMessage={setMessage} />}
        </div>
        {message && <div style={{ color: '#ffd866', fontSize: 13, marginTop: 6 }}>{message}</div>}
      </div>
      <button style={{ ...primaryButton, display: 'block', marginTop: 8, marginLeft: 'auto' }} onClick={onClose}>
        {t('ui.panel.close')}
      </button>
    </Modal>
  );
}

const reasonText = (reason: string) => tDyn(`ui.error.${reason}`);

// 採用の候補
function Candidates({ onMessage }: { onMessage: (m: string) => void }) {
  const candidates = useGameStore((s) => s.candidates);
  const office = useGameStore((s) => s.office);
  const hire = useGameStore((s) => s.hire);
  const companyExp = useGameStore((s) => s.companyExp);
  // 募集の職種の指定（人事がいるときだけ）
  const allStaff = useGameStore((s) => s.staff);
  const wish = useGameStore((s) => s.hiringWish);
  const setHiringWish = useGameStore((s) => s.setHiringWish);
  const hrP = backOfficeP(allStaff, 'hr', office, bonusEnvOf({ staff: allStaff, office: office }, gameEnv));
  const jobsOpen = unlockedJobsOf(levelOf(companyExp, balance), balance);
  // 夜勤の解放（会社のレベル）と、候補ごとに選んだ区分
  const nightOpen = levelOf(companyExp, balance) >= balance.featureUnlocks.nightShift;
  const [shiftOf, setShiftOf] = useState<Record<string, 'day' | 'night'>>({});
  // 空いている机がなければ、採用できない（座っている社員の机は、辞めるまで空かない）
  const freeSeats = freeDesks(office, allStaff, (id) => furniture[id as FurnitureId]?.seat === true);
  const full = freeSeats.length === 0;
  // 次に座る机に PC がないか（PC が要る職種の警告に使う・N102）
  const nextDeskHasPc = freeSeats[0] !== undefined && office.nodes.some((n) => n.x === freeSeats[0].x && n.y === freeSeats[0].y && isPcDevice(n.device));
  const yen = (n: number) => n.toLocaleString('ja-JP');
  return (
    <>
      {hrP > 0 && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 12, opacity: 0.85 }}>{t('ui.hiring.wish.label')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
            {[null, ...jobsOpen].map((j) => (
              <button
                key={j ?? 'none'}
                aria-pressed={wish === j}
                onClick={() => setHiringWish(j)}
                style={{ ...secondaryButton, padding: '2px 8px', fontSize: 12, background: wish === j ? '#ffd866' : secondaryButton.background, color: wish === j ? '#3b2a33' : secondaryButton.color }}
              >
                {j === null ? t('ui.hiring.wish.none') : tDyn(`staff.job.${j}`)}
              </button>
            ))}
          </div>
        </div>
      )}
      {candidates.length === 0 && <div style={{ opacity: 0.7 }}>{t('ui.hiring.none')}</div>}
      {candidates.map((c) => {
        // 内勤の札と、雇うと増える効果（席に座った場合の見込み）
        const back = isBackOffice(c.job);
        const effect = back ? jobEffect(c.job, c, c.level, backOfficeP(allStaff, c.job, office, bonusEnvOf({ staff: allStaff, office: office }, gameEnv)), balance) : null;
        return (
        <div
          key={c.uid}
          style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#25406f', borderRadius: RADIUS.none, padding: 8, marginBottom: 6 }}
        >
          <Icon name={`staff/${staffSpriteName(c.look)}_0`} scale={2} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 'bold' }}>{tDyn(c.name)}</div>
            <div style={{ fontSize: 12 }}>
              {tDyn(`staff.job.${c.job}`)} · {t('ui.staff.level', { level: c.level })}
              {/* 札: 内勤（非エンジニア枠）とエンジニア枠を分ける */}
              <span style={{ marginLeft: 6, padding: '0 4px', border: '1px solid #3b2a33', fontSize: 11, background: back ? '#ffd866' : '#5aa860', color: back ? '#3b2a33' : '#f4f1e6' }}>
                {t(back ? 'ui.hiring.tag.backOffice' : 'ui.hiring.tag.engineer')}
              </span>
            </div>
            <div style={{ fontSize: 12 }}>
              {t('ui.hiring.salary', { salary: yen(c.salary) })}
              {/* 雇ったあとの、月給の合計（今の月給の合計に足した額）。雇う前に負担が分かるように（N156） */}
              <span style={{ opacity: 0.8 }}> {t('ui.hiring.salaryTotal', { total: yen(totalSalary(allStaff, balance.nightPayRate) + c.salary) })}</span>
            </div>
            {/* PC が要る職種は、次に座る机に PC がないと働けない（採用はできる）（N102） */}
            {(c.job === 'dev' || c.job === 'hr' || c.job === 'accounting') && !nextDeskHasPc && !full && (
              <div style={{ fontSize: 12, color: '#ffd866' }}>{t('ui.hiring.noPc')}</div>
            )}
            {/* 内勤は、雇うと増える効果を1行で出す */}
            {effect && <div style={{ fontSize: 12, color: '#ffd866' }}>{jobEffectText(effect)}</div>}
          </div>
          {/* 夜勤は会社のレベルで解放される。解放されていれば、雇うときに区分を選ぶ（N48） */}
          {nightOpen && (
            <Select
              label={t('ui.hiring.shift')}
              value={shiftOf[c.uid] ?? 'day'}
              options={[
                { value: 'day', label: t('ui.hiring.shift.day') },
                { value: 'night', label: t('ui.hiring.shift.night') },
              ]}
              onChange={(v) => setShiftOf((m) => ({ ...m, [c.uid]: v as 'day' | 'night' }))}
            />
          )}
          <button
            style={{ ...secondaryButton, whiteSpace: 'nowrap', cursor: full ? 'default' : 'pointer', opacity: full ? 0.5 : 1 }}
            disabled={full}
            onClick={() => {
              const reason = hire(c.uid, shiftOf[c.uid] ?? 'day');
              onMessage(reason ? reasonText(reason) : '');
            }}
          >
            {t('ui.hiring.hire')}
          </button>
        </div>
        );
      })}
      {full &&<div style={{ color: '#ffd866', fontSize: 13 }}>{t('ui.error.seat')}</div>}
    </>
  );
}

// 社員の一覧。研修と資格の受験を行う
function StaffList({ onMessage }: { onMessage: (m: string) => void }) {
  const staff = useGameStore((s) => s.staff);
  const money = useGameStore((s) => s.clock.money);
  const busy = busyStaff({ active: useGameStore((s) => s.active) });
  const startTraining = useGameStore((s) => s.startTraining);
  const takeExam = useGameStore((s) => s.takeExam);
  const yen = (n: number) => n.toLocaleString('ja-JP');
  const courses = Object.values(training);
  const examList = Object.values(certs);
  return (
    <>
      {staff.map((s) => {
        const onProject = busy.has(s.uid);
        const locked = s.training !== null || onProject;
        return (
          <div key={s.uid} style={{ background: '#25406f', borderRadius: RADIUS.none, padding: 8, marginBottom: 6 }}>
            <div style={{ fontWeight: 'bold' }}>
              {tDyn(s.name)}{' '}
              <span style={{ fontWeight: 'normal', fontSize: 12 }}>
                {tDyn(`staff.job.${s.job}`)} · {t('ui.staff.level', { level: s.level })}
              </span>
            </div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>
              {s.training ? t('ui.training.busy') : onProject ? t('ui.training.onProject') : ''}
              {s.certs.length > 0 && ` · ${s.certs.map((id) => tDyn(`cert.${id}.name`)).join('、')}`}
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
                  {tDyn(`training.${c.id}.name`)}（{yen(c.cost)}円・{c.days}日）
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
                    {t('ui.exam.start')}：{tDyn(`cert.${c.id}.name`)}
                  </button></Tooltip>
                ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
