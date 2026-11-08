// 会社のレベルの印と経験値のゲージ（HUD）と、自社の情報の画面（N66）。
// HUD のレベルの欄を押すと、自社の情報の画面を開く（パソコンはウィンドウ、スマホは中央のパネル）。
import { useEffect, useRef, useState } from 'react';
import { balance } from 'virtual:game-data';
import { t, tDyn } from '../i18n/t';
import { expAtLevel, levelOf, levelProgressOf, needOf, nextLevel, titleKeyOf } from '../sim/level';
import { unlockItems, useGameStore } from '../stores/useGameStore';
import { Icon } from './Icon';
import { ItemCards, unlockNameOf } from './UnlockList';
import { Tooltip } from './Tooltip';
import { tipText } from '../input/keymap';
import { outsideCheck } from '../network/external';
import { gameEnv, isPcDevice } from '../sim/env';
import { pcDesksOf } from '../sim/furniture';

// 増えた経験値の「+N」を出している時間（ms）
const GAIN_MS = 1500;
// レベルの印と経験値の色（レベルの印のエメラルド色に合わせる）
export const GAUGE_COLOR = '#2eb87a';

// レベルの印（エメラルドの宝石）と Lv
export function LevelMark({ level }: { level: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
      <Icon name="icon/level" scale={1.5} />
      {t('ui.hud.level', { level })}
    </span>
  );
}

// 今のレベルの中の進み具合を横長の棒で出す（数値は出さない）。経験値が増えたら「+N」をゲージの上に短く出す（N55）
export function ExpGauge({ companyExp, width }: { companyExp: number; width: number }) {
  const fraction = levelProgressOf(companyExp, balance);
  const [gain, setGain] = useState<{ amount: number; at: number } | null>(null);
  const prev = useRef(companyExp);
  useEffect(() => {
    const diff = companyExp - prev.current;
    prev.current = companyExp;
    if (diff <= 0) return;
    const at = Date.now();
    setGain({ amount: diff, at });
    const id = window.setTimeout(() => setGain((g) => (g && g.at === at ? null : g)), GAIN_MS);
    return () => window.clearTimeout(id);
  }, [companyExp]);
  return (
    <span style={{ position: 'relative', display: 'inline-block', width, height: 8, background: '#3b2a33' }}>
      <span style={{ display: 'block', width: `${fraction * 100}%`, height: '100%', background: GAUGE_COLOR }} />
      {gain && (
        <span style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)', color: '#f4f1e6', fontSize: 12, lineHeight: 1, fontWeight: 'bold', whiteSpace: 'nowrap', textShadow: '0 0 2px #3b2a33, 0 0 1px #3b2a33' }}>
          +{gain.amount}
        </span>
      )}
    </span>
  );
}

// 自社の情報の画面の中身。レベル・経験値・評判・社員・納品・次のレベルで解放される物
export function CompanyBody() {
  const companyExp = useGameStore((s) => s.companyExp);
  const reputation = useGameStore((s) => s.reputation);
  const deliveries = useGameStore((s) => s.deliveries);
  const staff = useGameStore((s) => s.staff);
  const office = useGameStore((s) => s.office);
  const money = useGameStore((s) => s.clock.money);
  // 机に PC がなく働けない社内の職種の人数（N102）
  const noPcCount = useGameStore((s) => {
    const pcDesks = pcDesksOf(s.office, isPcDevice);
    return s.staff.filter((m) => (m.job === 'dev' || m.job === 'hr' || m.job === 'accounting') && !(m.desk !== null && pcDesks.includes(m.desk))).length;
  });
  const outside = outsideCheck(office, gameEnv.engine);
  const night = staff.filter((m) => m.shift === 'night').length;
  const open = (kind: 'staffList' | 'funds' | 'office') => useGameStore.getState().openWindow(kind, '');
  const link = { background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer', textDecoration: 'underline' } as const;
  const level = levelOf(companyExp, balance);
  const next = nextLevel(companyExp, balance);
  const inLevel = companyExp - expAtLevel(level, balance);
  const need = needOf(level, balance);
  const titleKey = titleKeyOf(level);
  const unlocks = next ? unlockItems.filter((x) => x.unlockLevel === next.level) : [];
  const devices = unlocks.filter((x) => x.kind === 'device' || x.kind === 'furniture').map((x) => ({ kind: x.kind as 'device' | 'furniture', id: x.id }));
  const others = unlocks.filter((x) => x.kind !== 'device' && x.kind !== 'furniture');
  // 次のレベルで解放される職種（採用の候補に出る）
  const jobsUnlockedAt = next ? (Object.keys(balance.hiring.jobUnlockLevels) as (keyof typeof balance.hiring.jobUnlockLevels)[]).filter((j) => balance.hiring.jobUnlockLevels[j] === next.level) : [];
  const row = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #3b2a33' } as const;
  // 会社の総覧。社員・資金・外部への接続は要約だけを出し、押すとそれぞれの画面を開く（詳細は各画面・N126）
  return (
    <div style={{ padding: 12, fontSize: 14, color: '#f4f1e6' }}>
      <div style={{ ...row, fontSize: 16 }}>
        <LevelMark level={level} />
        {titleKey && <span style={{ color: '#ffd866' }}>{tDyn(titleKey)}</span>}
      </div>
      <div style={row}>
        <span>{t('ui.company.exp')}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{next ? `${inLevel} / ${need}` : t('ui.company.max')}</span>
          <ExpGauge companyExp={companyExp} width={120} />
        </span>
      </div>
      <div style={row}>
        <span>{t('ui.company.reputation')}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Icon name="icon/star" scale={1} />
          {reputation}
        </span>
      </div>
      <div style={row}>
        <span>{t('ui.company.staff')}</span>
        {/* 社員の一覧を開くボタンはここだけ（採用の画面は候補が0人だと開けない）。キーは H */}
        <Tooltip text={tipText('keys.staffList', 'staffList')}>
          <button style={link} onClick={() => open('staffList')}>
            {t('ui.company.staffCount', { total: staff.length, day: staff.length - night, night })}
          </button>
        </Tooltip>
      </div>
      {noPcCount > 0 && (
        <div style={row}>
          <span>{t('ui.company.noPc')}</span>
          <button style={{ ...link, color: '#ffd866' }} onClick={() => open('staffList')}>
            {t('ui.company.noPc.count', { count: noPcCount })}
          </button>
        </div>
      )}
      <div style={row}>
        <span>{t('ui.company.funds')}</span>
        <button style={link} onClick={() => open('funds')}>
          {money.toLocaleString('ja-JP')}円
        </button>
      </div>
      <div style={row}>
        <span>{t('ui.company.outside')}</span>
        <button style={link} onClick={() => open('office')}>
          {!outside.attached ? t('ui.company.outside.none') : outside.pcsReachOutside ? t('ui.company.outside.ok') : t('ui.company.outside.ng')}
        </button>
      </div>
      <div style={row}>
        <span>{t('ui.company.delivered')}</span>
        <span>{t('ui.company.count', { count: deliveries })}</span>
      </div>
      <div style={{ paddingTop: 8 }}>
        <div style={{ color: '#ffd866' }}>{next ? t('ui.company.next', { level: next.level }) : t('ui.company.max')}</div>
        {next && unlocks.length === 0 && <div style={{ opacity: 0.85 }}>{t('ui.company.nothing')}</div>}
        {devices.length > 0 && <ItemCards items={devices} />}
        {others.length > 0 && <div style={{ marginTop: 4 }}>{others.map((x) => unlockNameOf(x)).join('・')}</div>}
        {/* 職種（採用の候補に出る職種）も、解放のレベルで案内する（N84） */}
        {jobsUnlockedAt.length > 0 && <div style={{ marginTop: 4 }}>{t('ui.company.jobs', { jobs: jobsUnlockedAt.map((j) => tDyn(`staff.job.${j}`)).join('・') })}</div>}
      </div>
    </div>
  );
}
