// 教材の一覧（論点ごと）。選ぶと、いまの構成を教材の初期の構成に置き換える。置き換える前に確認を出す（保存していない構成が失われるため）
import { useState } from 'react';
import { lessons } from 'virtual:game-data';
import { t, tDyn } from '../i18n/t';
import { useGameStore } from '../stores/useGameStore';
import { Modal, primaryButton, secondaryButton } from './Modal';

export function LessonPicker({ onClose }: { onClose: () => void }) {
  const openLesson = useGameStore((s) => s.openLesson);
  const [picked, setPicked] = useState<string | null>(null);
  const topics = [...new Set(lessons.map((l) => l.topic))];

  if (picked !== null) {
    return (
      <Modal onClose={() => setPicked(null)} primary={() => { openLesson(picked); onClose(); }} boxStyle={{ width: 'min(320px, calc(100% - 32px))' }}>
        <div style={{ fontWeight: 'bold' }}>{tDyn(`lesson.${picked}.title`)}</div>
        <div style={{ marginTop: 8, fontSize: 13 }}>{t('ui.lesson.confirm')}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button style={secondaryButton} onClick={() => setPicked(null)}>{t('ui.sandbox.size.cancel')}</button>
          <button style={primaryButton} onClick={() => { openLesson(picked); onClose(); }}>{t('ui.lesson.start')}</button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal onClose={onClose} boxStyle={{ width: 'min(320px, calc(100% - 32px))' }}>
      <div style={{ fontWeight: 'bold' }}>{t('ui.lesson.open')}</div>
      {topics.map((topic) => (
        <div key={topic} style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.8 }}>{tDyn(`ui.lesson.topic.${topic}`)}</div>
          {lessons
            .filter((l) => l.topic === topic)
            .sort((a, b) => a.order - b.order)
            .map((l) => (
              <button key={l.id} style={{ ...secondaryButton, display: 'block', width: '100%', margin: '4px 0', textAlign: 'left' }} onClick={() => setPicked(l.id)}>
                {tDyn(`lesson.${l.id}.title`)}
              </button>
            ))}
        </div>
      ))}
    </Modal>
  );
}
