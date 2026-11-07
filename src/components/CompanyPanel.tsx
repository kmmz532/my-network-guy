// 会社のレベルの印と経験値のゲージ（HUD）と、自社の情報の画面（N66）。
// HUD のレベルの欄を押すと、自社の情報の画面を開く（パソコンはウィンドウ、スマホは中央のパネル）。
import { useEffect, useRef, useState } from 'react';
import { balance } from 'virtual:game-data';
import { t, tDyn } from '../i18n/t';
import { expAtLevel, levelOf, levelProgressOf, needOf, nextLevel, titleKeyOf } from '../sim/level';
import { unlockItems, useGameStore } from '../stores/useGameStore';
import { Icon } from './Icon';
import { outsideCheck, rentalOf } from '../network/external';
import { gameEnv } from '../sim/env';
import { ItemCards, unlockNameOf } from './UnlockList';
import { Tooltip } from './Tooltip';
import { tipText } from '../input/keymap';
import { pcDesksOf } from '../sim/furniture';
import { printerArrivalBonusOf } from '../sim/backOffice';
import { isPcDevice } from '../sim/env';
import { Select } from './Select';
import { floorOfRoom, roomTileCount } from '../sim/office';
import type { RoomId } from '../sim/project';
import type { FloorId } from '../data/schema';

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
  const staff = useGameStore((s) => s.staff);
  const deliveries = useGameStore((s) => s.deliveries);
  const office = useGameStore((s) => s.office);
  const money = useGameStore((s) => s.clock.money);
  // 今月の開発の収入（システムエンジニアが、担当でない日に得た額）
  const devThisMonth = useGameStore((s) => {
    const month = Math.floor(s.clock.minute / (balance.time.daysPerMonth * 24 * 60));
    return s.clock.ledger?.find((m) => m.month === month)?.totals.dev ?? 0;
  });
  // 今月の節約（経理の割引で浮いた額）
  const savedThisMonth = useGameStore((s) => {
    const month = Math.floor(s.clock.minute / (balance.time.daysPerMonth * 24 * 60));
    return s.clock.ledger?.find((m) => m.month === month)?.totals.saved ?? 0;
  });
  // 自社のネットワークの外部への接続と、サーバーの貸し出し（N71・N72）
  const outside = outsideCheck(office, gameEnv.engine);
  const level = levelOf(companyExp, balance);
  // プリンターが営業の依頼に足す確率（N98）
  const printerBonus = useGameStore((s) => printerArrivalBonusOf(s.office, (d) => gameEnv.devices[d]?.category === 'printer', balance));
  // 机に PC がない社内の職種の人数（働けない・N102）
  const noPcCount = useGameStore((s) => {
    const pcDesks = pcDesksOf(s.office, isPcDevice);
    return s.staff.filter((m) => (m.job === 'dev' || m.job === 'hr' || m.job === 'accounting') && !(m.desk !== null && pcDesks.includes(m.desk))).length;
  });
  const rental = rentalOf(office, gameEnv.engine, balance.rental, level, balance.time.daysPerMonth);
  const next = nextLevel(companyExp, balance);
  const inLevel = companyExp - expAtLevel(level, balance);
  const need = needOf(level, balance);
  const night = staff.filter((m) => m.shift === 'night').length;
  const titleKey = titleKeyOf(level);
  const unlocks = next ? unlockItems.filter((x) => x.unlockLevel === next.level) : [];
  const devices = unlocks.filter((x) => x.kind === 'device' || x.kind === 'furniture').map((x) => ({ kind: x.kind as 'device' | 'furniture', id: x.id }));
  const others = unlocks.filter((x) => x.kind !== 'device' && x.kind !== 'furniture');
  // 次のレベルで解放される職種（採用の候補に出る）
  const jobsUnlockedAt = next ? (Object.keys(balance.hiring.jobUnlockLevels) as (keyof typeof balance.hiring.jobUnlockLevels)[]).filter((j) => balance.hiring.jobUnlockLevels[j] === next.level) : [];
  const row = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #3b2a33' } as const;
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
        {/* 押すと社員の一覧を開く。キーは H（ツールチップで示す） */}
        <Tooltip text={tipText('keys.staffList', 'staffList')}>
          <button style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => useGameStore.getState().openWindow('staffList', '')}>
            {t('ui.company.staffCount', { total: staff.length, day: staff.length - night, night })}
          </button>
        </Tooltip>
      </div>
      <div style={row}>
        <span>{t('ui.company.funds')}</span>
        <button style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => useGameStore.getState().openWindow('funds', '')}>
          {money.toLocaleString('ja-JP')}円
        </button>
      </div>
      {printerBonus > 0 && (
        <div style={row}>
          <span>{t('ui.company.printer')}</span>
          <span>{t('ui.company.printer.value', { pct: Math.round(printerBonus * 1000) / 10 })}</span>
        </div>
      )}
      {/* PC がなく働けない社内の職種の人数（N102） */}
      {noPcCount > 0 && (
        <div style={row}>
          <span>{t('ui.company.noPc')}</span>
          <span>{t('ui.company.noPc.count', { count: noPcCount })}</span>
        </div>
      )}
      {devThisMonth > 0 && (
        <div style={row}>
          <span>{t('ui.company.dev')}</span>
          <span>{devThisMonth.toLocaleString('ja-JP')}円</span>
        </div>
      )}
      {savedThisMonth > 0 && (
        <div style={row}>
          <span>{t('ui.company.saved')}</span>
          <span>{savedThisMonth.toLocaleString('ja-JP')}円</span>
        </div>
      )}
      <div style={row}>
        <span>{t('ui.company.delivered')}</span>
        <span>{t('ui.company.count', { count: deliveries })}</span>
      </div>
      <div style={row}>
        <span>{t('ui.company.outside')}</span>
        <span>{!outside.attached ? t('ui.company.outside.none') : outside.pcsReachOutside ? t('ui.company.outside.ok') : t('ui.company.outside.ng')}</span>
      </div>
      {outside.attached && (
        <div style={row}>
          <span>{t('ui.company.rental')}</span>
          <span>{outside.leaks ? t('ui.company.rental.leak') : t('ui.company.rental.value', { count: outside.exposedServers.length, income: rental.monthly.toLocaleString('ja-JP') })}</span>
        </div>
      )}
      {/* 床（部屋ごとの床の種類）。解禁のレベルに届いてから出す（N92） */}
      {level >= balance.featureUnlocks.floorChange && <FloorRows />}
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

// 部屋ごとの床の張り替え（N92）。部屋を選び、床の種類を選ぶ。解禁前の種類は鍵の文字と解禁のレベルを出す
function FloorRows() {
  const office = useGameStore((s) => s.office);
  const level = useGameStore((s) => levelOf(s.companyExp, balance));
  const changeFloor = useGameStore((s) => s.changeFloor);
  const [message, setMessage] = useState<string | null>(null);
  const yen = (n: number) => n.toLocaleString('ja-JP');
  const rooms: RoomId[] = ['main', ...office.annexes];
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ color: '#ffd866' }}>{t('ui.floor.title')}</div>
      {rooms.map((room) => {
        const current = floorOfRoom(office, room);
        const tiles = roomTileCount(office, room);
        const options = balance.floors.map((f) => {
          const name = t(`ui.floor.${f.id}` as const);
          if (level < f.unlockLevel) return { value: f.id, label: `${name}（${t('ui.floor.locked', { level: f.unlockLevel })}）` };
          const cost = f.id === current ? '' : office.bought.includes(f.id) ? `（${t('ui.floor.bought')}）` : `（${yen(f.costPerTile * tiles)}円）`;
          return { value: f.id, label: `${name}${cost}` };
        });
        return (
          <div key={room} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '4px 0' }}>
            <span>{t(`ui.floor.room.${room}` as const)}</span>
            <Select
              label={t(`ui.floor.room.${room}` as const)}
              value={current}
              options={options}
              onChange={(v) => {
                const reason = changeFloor(room, v as FloorId);
                setMessage(reason ? tDyn(`ui.error.${reason}`) : null);
              }}
            />
          </div>
        );
      })}
      {message && <div style={{ color: '#ffd866', fontSize: 12 }}>{message}</div>}
    </div>
  );
}
