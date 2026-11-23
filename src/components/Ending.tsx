// エンディング（最後の山場の納品の結果の後に1回だけ）。社員が部屋の中央に集まり、会社の歩みの札を1枚ずつ出し、スタッフロールを流して、最後の言葉でゲームに戻る。
// 社員の歩きは OfficeStaffMotion が、ending が playing の間に行う。
import { useEffect, useMemo, useState } from 'react';
import { balance } from 'virtual:game-data';
import { t, tDyn } from '../i18n/t';
import { CREDIT_HEADINGS, ENDING_MS, endingFactsOf, nextEndingPhase, skipCredits, type EndingFacts, type EndingPhase } from '../sim/ending';
import { useGameStore } from '../stores/useGameStore';
import { Modal } from './Modal';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Heading } from './ui/Heading';
import { Text } from './ui/Text';

const yen = (n: number) => n.toLocaleString('ja-JP');

// 会社の歩みの札（見出しと値）。この順に1枚ずつ出す
const factCardsOf = (f: EndingFacts): { key: string; label: string; value: string }[] => {
  if (f.biggest === null) throw new Error('最も大きな案件の記録がない');
  if (f.longest === null) throw new Error('社員がいない');
  const tenure = { years: Math.floor(f.longest.months / 12), months: f.longest.months % 12 };
  return [
    { key: 'years', label: t('ui.ending.label.years'), value: t('ui.ending.value.years', { years: f.years, months: f.months }) },
    { key: 'deliveries', label: t('ui.ending.label.deliveries'), value: t('ui.ending.value.count', { count: f.deliveries }) },
    { key: 'threeStars', label: t('ui.ending.label.threeStars'), value: t('ui.ending.value.count', { count: f.threeStars }) },
    { key: 'biggest', label: t('ui.ending.label.biggest'), value: t('ui.ending.value.biggest', { title: tDyn(`contract.${f.biggest.baseId}.title`, f.biggest.params), money: yen(f.biggest.money) }) },
    { key: 'staff', label: t('ui.ending.label.staff'), value: t('ui.ending.value.people', { count: f.staffCount }) },
    { key: 'longest', label: t('ui.ending.label.longest'), value: t('ui.ending.value.longest', { name: tDyn(f.longest.name), ...tenure }) },
  ];
};

export function Ending() {
  const ending = useGameStore((s) => s.ending);
  const waiting = useGameStore((s) => s.lastReport !== null || s.showcase !== null);
  const startEnding = useGameStore((s) => s.startEnding);
  const finishEnding = useGameStore((s) => s.finishEnding);
  const [phase, setPhase] = useState<EndingPhase>({ kind: 'gather' });
  // 結果の画面を閉じたら始める
  useEffect(() => {
    if (ending === 'pending' && !waiting) {
      setPhase({ kind: 'gather' });
      startEnding();
    }
  }, [ending, waiting, startEnding]);
  const cards = useMemo(() => (ending === 'playing' ? factCardsOf(endingFactsOf(useGameStore.getState(), balance)) : []), [ending]);
  const advance = () => setPhase((p) => nextEndingPhase(p, cards.length) ?? p);
  useEffect(() => {
    if (ending !== 'playing' || phase.kind === 'last') return;
    const id = window.setTimeout(advance, ENDING_MS[phase.kind]);
    return () => window.clearTimeout(id);
  }, [ending, phase, cards]);
  if (ending !== 'playing' || phase.kind === 'gather') return null;

  if (phase.kind === 'card') {
    const card = cards[phase.index];
    return (
      <Modal onClose={advance} primary={advance} boxStyle={{ textAlign: 'center', minWidth: 260 }}>
        <Heading level="window">{t('ui.ending.title')}</Heading>
        <Card layout={{ marginTop: 8 }}>
          <Text tone="sub" layout={{ marginBottom: 4 }}>{card.label}</Text>
          <Text size="xl" bold>{card.value}</Text>
        </Card>
        <Button variant="primary" layout={{ marginTop: 12 }} onClick={advance}>{t('ui.ending.next')}</Button>
      </Modal>
    );
  }
  if (phase.kind === 'credits') {
    const skip = () => setPhase(skipCredits());
    return (
      <Modal variant="screen" onClose={skip} primary={skip} boxStyle={{ textAlign: 'center' }}>
        <Heading level="section">{t(`ui.ending.credit.${CREDIT_HEADINGS[phase.index]}`)}</Heading>
        <Text size="l" layout={{ marginTop: 8 }}>{t('ui.ending.credit.name')}</Text>
        <Button variant="secondary" layout={{ marginTop: 16 }} onClick={skip}>{t('ui.ending.skip')}</Button>
      </Modal>
    );
  }
  return (
    <Modal variant="screen" onClose={finishEnding} primary={finishEnding} boxStyle={{ textAlign: 'center' }}>
      <Heading level="screen">{t('ui.ending.last')}</Heading>
      <Button variant="primary" layout={{ marginTop: 16 }} onClick={finishEnding}>{t('ui.ending.close')}</Button>
    </Modal>
  );
}
