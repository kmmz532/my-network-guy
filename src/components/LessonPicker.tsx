// 教材の一覧（論点ごと）。選ぶと、いまの構成を教材の初期の構成に置き換える。置き換える前に確認を出す（保存していない構成が失われるため）
import { useState } from 'react';
import { lessonEntryOf } from '../sim/lessonCatalog';
import { lessonCatalog } from '../stores/lessonCatalog';
import { t, tDyn } from '../i18n/t';
import { useGameStore } from '../stores/useGameStore';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';

export function LessonPicker({ onClose }: { onClose: () => void }) {
  const openLesson = useGameStore((s) => s.openLesson);
  const [picked, setPicked] = useState<string | null>(null);
  const topics = [...new Set(lessonCatalog.map((l) => l.group))];
  const titleOf = (id: string) => tDyn(lessonEntryOf(lessonCatalog, id).titleKey);

  if (picked !== null) {
    return (
      <Dialog onClose={() => setPicked(null)} primary={() => { openLesson(picked); onClose(); }} layout={{ width: 'min(320px, calc(100% - 32px))' }}>
        <div style={{ fontWeight: 'bold' }}>{titleOf(picked)}</div>
        <div style={{ marginTop: 8, fontSize: 13 }}>{t('ui.lesson.confirm')}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <Button variant="secondary" onClick={() => setPicked(null)}>{t('ui.sandbox.size.cancel')}</Button>
          <Button variant="primary" onClick={() => { openLesson(picked); onClose(); }}>{t('ui.lesson.start')}</Button>
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog onClose={onClose} layout={{ width: 'min(320px, calc(100% - 32px))' }}>
      <div style={{ fontWeight: 'bold' }}>{t('ui.lesson.open')}</div>
      {topics.map((topic) => (
        <div key={topic} style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.8 }}>{tDyn(`ui.lesson.topic.${topic}`)}</div>
          {lessonCatalog
            .filter((l) => l.group === topic)
            .sort((a, b) => a.order - b.order)
            .map((l) => (
              <Button key={l.id} variant="secondary" size="row" layout={{ width: '100%', margin: '4px 0' }} onClick={() => setPicked(l.id)}>
                {tDyn(l.titleKey)}
              </Button>
            ))}
        </div>
      ))}
    </Dialog>
  );
}
