// 資金の画面。残高と月末の見通し、今月の分類ごとの内訳、直近12か月の収支（資金の動きを帳簿から出す）
import { balance } from 'virtual:game-data';
import { t, tDyn } from '../i18n/t';
import { levelOf } from '../sim/level';
import { LEDGER_CATEGORIES, type LedgerCategory } from '../sim/ledger';
import { minutesPerDay, minutesPerMonth } from '../sim/clock';
import { totalSalary } from '../sim/staff';
import { rentalOf } from '../network/external';
import { gameEnv } from '../sim/env';
import { useGameStore } from '../stores/useGameStore';
import { Section } from './ui/Section';

const yen = (n: number) => `${Math.round(n).toLocaleString('ja-JP')}円`;

export function FundsBody() {
  const clock = useGameStore((s) => s.clock);
  const staff = useGameStore((s) => s.staff);
  const office = useGameStore((s) => s.office);
  const companyExp = useGameStore((s) => s.companyExp);
  const ledger = clock.ledger ?? [];
  const monthLength = minutesPerMonth(balance);
  const month = Math.floor(clock.minute / monthLength);
  const thisMonth = ledger.find((m) => m.month === month);
  // 見通し: 今の残高 ＋ 今月の残りの日の貸し出しの見込み − 給与（次の月の区切りで払う）
  const daysLeft = Math.max(0, balance.time.daysPerMonth - Math.floor((clock.minute % monthLength) / minutesPerDay) - 1);
  const rent = rentalOf(office, gameEnv.engine, balance.rental, levelOf(companyExp, balance), balance.time.daysPerMonth);
  const salary = totalSalary(staff, balance.nightPayRate);
  const outlook = clock.money + rent.daily * daysLeft - salary;
  // 直近の月の収支（分類の合計）。古いものから並べる
  const history = [...ledger].sort((a, b) => a.month - b.month);
  // 収支の合計はお金の増減だけ（経理で浮いた額は含めない）
  const net = (m: { totals: Record<LedgerCategory, number> }) => LEDGER_CATEGORIES.filter((c) => c !== 'saved').reduce((s, c) => s + m.totals[c], 0);
  const maxAbs = Math.max(1, ...history.map((m) => Math.abs(net(m))));
  // 行の中身（行の区切りは Section が引く）
  const rowLine = { display: 'flex', justifyContent: 'space-between', gap: 8 } as const;
  return (
    // スクロールはウィンドウの本体だけで行う（中身の枠は持たない・N105）
    <div style={{ padding: 12, fontSize: 14, color: '#f4f1e6' }}>
      <Section>
        <div style={{ ...rowLine, fontSize: 16 }}>
          <span>{t('ui.funds.balance')}</span>
          <span>{clock.ledger === null ? '∞' : yen(clock.money)}</span>
        </div>
      </Section>
      <Section>
        <div style={rowLine}>
          <span>{t('ui.funds.outlook')}</span>
          <span style={{ color: outlook < 0 ? '#ff8a80' : undefined }}>{yen(outlook)}</span>
        </div>
      </Section>
      <div style={{ paddingTop: 8, color: '#ffd866' }}>{t('ui.funds.thisMonth')}</div>
      {LEDGER_CATEGORIES.map((c: LedgerCategory) => {
        const value = thisMonth?.totals[c] ?? 0;
        return (
          <Section key={c}>
            <div style={rowLine}>
              <span>{tDyn(`ledger.${c}`)}</span>
              <span style={{ color: value < 0 ? '#ff8a80' : undefined }}>{value === 0 ? '—' : yen(value)}</span>
            </div>
          </Section>
        );
      })}
      <div style={{ paddingTop: 8, color: '#ffd866' }}>{t('ui.funds.history')}</div>
      {history.length === 0 && <div style={{ opacity: 0.85 }}>{t('ui.funds.none')}</div>}
      {history.map((m) => {
        const value = net(m);
        const width = `${(Math.abs(value) / maxAbs) * 100}%`;
        return (
          <div key={m.month} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
            <span style={{ width: 40 }}>{`${(m.month % 12) + 1}月`}</span>
            <span style={{ flex: 1, height: 10, background: '#3b2a33', position: 'relative' }}>
              <span style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width, background: value < 0 ? '#ff8a80' : '#62d26f' }} />
            </span>
            <span style={{ width: 96, textAlign: 'right' }}>{yen(value)}</span>
          </div>
        );
      })}
    </div>
  );
}
