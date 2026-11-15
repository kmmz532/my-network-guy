// 教材の一覧（論点ごと）。選ぶと、いまの構成を教材の初期の構成に置き換える。置き換える前に確認を出す（保存していない構成が失われるため）
import { useState } from 'react';
import { lessonEntryOf } from '../sim/lessonCatalog';
import { lessonCatalog } from '../stores/lessonCatalog';
import { t, tDyn } from '../i18n/t';
import { useGameStore } from '../stores/useGameStore';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Text } from './ui/Text';

// onPick を渡すと、置き換えの確認を出さずに選んだ教材を返す（新しく始めるときは失う構成がないため）
export function LessonPicker({ onClose, onPick }: { onClose: () => void; onPick?: (id: string) => void }) {
  const openLesson = useGameStore((s) => s.openLesson);
  const [picked, setPicked] = useState<string | null>(null);
  const topics = [...new Set(lessonCatalog.map((l) => l.group))];
  const titleOf = (id: string) => tDyn(lessonEntryOf(lessonCatalog, id).titleKey);

  if (picked !== null) {
    return (
      <Dialog onClose={() => setPicked(null)} primary={() => { openLesson(picked); onClose(); }} layout={{ width: 'min(320px, calc(100% - 32px))' }}>
        <Text bold size="l">{titleOf(picked)}</Text>
        <Text size="sm" layout={{ marginTop: 8 }}>{t('ui.lesson.confirm')}</Text>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <Button variant="secondary" onClick={() => setPicked(null)}>{t('ui.sandbox.size.cancel')}</Button>
          <Button variant="primary" onClick={() => { openLesson(picked); onClose(); }}>{t('ui.lesson.start')}</Button>
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog onClose={onClose} layout={{ width: 'min(320px, calc(100% - 32px))', maxHeight: 'calc(100% - 32px)', overflowY: 'auto' }}>
      <Text bold size="l">{t('ui.lesson.open')}</Text>
      {topics.map((topic) => (
        <div key={topic} style={{ marginTop: 8 }}>
          <Text tone="soft" size="s">{tDyn(`ui.lesson.topic.${topic}`)}</Text>
          {lessonCatalog
            .filter((l) => l.group === topic)
            .sort((a, b) => a.order - b.order)
            .map((l) => (
              <Button key={l.id} variant="secondary" size="row" layout={{ width: '100%', margin: '4px 0' }} onClick={() => (onPick ? onPick(l.id) : setPicked(l.id))}>
                {tDyn(l.titleKey)}
              </Button>
            ))}
        </div>
      ))}
    </Dialog>
  );
}
