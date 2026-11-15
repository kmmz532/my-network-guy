// 別のタブで同じゲームを開いているときの表示（N27）。続けるまで、この画面の操作を止める
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n/t';
import { startTabGuard, type TabGuard } from '../services/tabGuard';
import { Blocker } from './ui/Blocker';
import { Button } from './ui/Button';
import { Text } from './ui/Text';

// slot は今開いている会社の枠（タイトル画面は null）。同じ会社を別のタブで開いたときだけ止める（N133）
export function TabConflict({ slot }: { slot: number | null }) {
  const [conflict, setConflict] = useState(false);
  const [continued, setContinued] = useState(false);
  const guard = useRef<TabGuard | null>(null);
  useEffect(() => {
    const g = startTabGuard(() => setConflict(true), slot);
    guard.current = g;
    return () => g.stop();
    // 最初の1回だけ作る（枠の変更は下の effect で知らせる）
  }, []);
  useEffect(() => {
    guard.current?.setSlot(slot);
  }, [slot]);
  if (!conflict || continued) return null;
  return (
    <Blocker>
      <Text size="l" bold layout={{ marginBottom: 8 }}>{t('ui.tab.conflict.title')}</Text>
      <Text layout={{ marginBottom: 12 }}>{t('ui.tab.conflict.body')}</Text>
      <Button variant="alert" onClick={() => setContinued(true)}>
        {t('ui.tab.conflict.continue')}
      </Button>
    </Blocker>
  );
}
