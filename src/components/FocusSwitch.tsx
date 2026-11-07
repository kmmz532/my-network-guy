// 画面の対象の切り替え（N111）。自社オフィスと、進行中の案件（自分の設計・任せた依頼）を行き来できる
import { t, tDyn } from '../i18n/t';
import { useGameStore } from '../stores/useGameStore';

export function FocusSwitch() {
  const active = useGameStore((s) => s.active);
  const focus = useGameStore((s) => s.focus);
  const setFocus = useGameStore((s) => s.setFocus);
  // 案件がなければ、自社オフィスしかないため出さない
  if (active.length === 0) return null;
  const items: { id: string | null; label: string }[] = [
    { id: null, label: t('ui.focus.office') },
    ...active.map((p) => ({ id: p.id, label: tDyn(`contract.${p.baseId}.title`, p.params) })),
  ];
  return (
    <div role="group" aria-label={t('ui.focus.label')} style={{ position: 'absolute', top: 44, left: 8, display: 'flex', gap: 4, flexWrap: 'wrap', zIndex: 5 }}>
      {items.map((i) => {
        const on = i.id === focus;
        return (
          <button
            key={i.id ?? 'office'}
            aria-pressed={on}
            onClick={() => setFocus(i.id)}
            style={{
              padding: '2px 8px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              background: on ? '#ffd866' : '#25406f',
              color: on ? '#3b2a33' : '#f4f1e6',
              border: '1px solid #3b2a33',
            }}
          >
            {i.label}
          </button>
        );
      })}
    </div>
  );
}
