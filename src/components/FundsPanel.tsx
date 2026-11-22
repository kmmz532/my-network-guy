// 資金の画面。残高と月末の見通し、今月の分類ごとの内訳、直近12か月の収支（資金の動きを帳簿から出す）
import { balance } from 'virtual:game-data';
import { t, tDyn } from '../i18n/t';
import { levelOf } from '../sim/level';
import { LEDGER_CATEGORIES, type LedgerCategory } from '../sim/ledger';
import { minutesPerDay, minutesPerMonth } from '../sim/clock';
import { rentalOf } from '../network/external';
import { gameEnv } from '../sim/env';
import { payrollOfState, useGameStore } from '../stores/useGameStore';
import { Section } from './ui/Section';
import { Text } from './ui/Text';
import { ProgressBar } from './ui/ProgressBar';

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
  const salary = payrollOfState({ staff, office });
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
    <div style={{ padding: 12 }}>
      <Section>
        <div style={rowLine}>
          <Text as="span" size="l">{t('ui.funds.balance')}</Text>
          <Text as="span" size="l">{clock.ledger === null ? '∞' : yen(clock.money)}</Text>
        </div>
      </Section>
      <Section>
        <div style={rowLine}>
          <Text as="span">{t('ui.funds.outlook')}</Text>
          <Text as="span" tone={outlook < 0 ? 'error' : 'normal'}>{yen(outlook)}</Text>
        </div>
      </Section>
      <Text tone="warn" layout={{ marginTop: 8 }}>{t('ui.funds.thisMonth')}</Text>
      {LEDGER_CATEGORIES.map((c: LedgerCategory) => {
        const value = thisMonth?.totals[c] ?? 0;
        return (
          <Section key={c}>
            <div style={rowLine}>
              <Text as="span">{tDyn(`ledger.${c}`)}</Text>
              <Text as="span" tone={value < 0 ? 'error' : 'normal'}>{value === 0 ? '—' : yen(value)}</Text>
            </div>
          </Section>
        );
      })}
      <Text tone="warn" layout={{ marginTop: 8 }}>{t('ui.funds.history')}</Text>
      {history.length === 0 && <Text tone="sub">{t('ui.funds.none')}</Text>}
      {history.map((m) => {
        const value = net(m);
        return (
          <div key={m.month} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
            <Text as="span" layout={{ width: 40 }}>{`${(m.month % 12) + 1}月`}</Text>
            <ProgressBar size="m" fraction={Math.abs(value) / maxAbs} color={value < 0 ? 'var(--st-error)' : 'var(--st-ok)'} layout={{ flex: 1 }} />
            <div style={{ width: 96, textAlign: 'right' }}><Text as="span">{yen(value)}</Text></div>
          </div>
        );
      })}
    </div>
  );
}
