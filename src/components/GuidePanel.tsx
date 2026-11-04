import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import { currentGuideStep, firstContractGuide, type GuideStep } from '../sim/guide';
import { useGameStore } from '../stores/useGameStore';
import { panelStyle } from './panelStyle';


const STEP_KEY: Record<GuideStep, LangKey> = {
  accept: 'ui.guide.accept',
  ip: 'ui.guide.ip',
  wire: 'ui.guide.wire',
  probe: 'ui.guide.probe',
  build: 'ui.guide.build',
};

// 最初の案件の間だけ、次に行う操作を案内する
export function GuidePanel() {
  const active = useGameStore((s) => s.active);
  const trace = useGameStore((s) => s.lastTrace);
  const completed = useGameStore((s) => s.completed);
  const items = firstContractGuide(active, trace, completed);
  const current = currentGuideStep(items);
  if (current === null) return null;

  return (
    <section style={panelStyle}>
      <h2 style={{ fontSize: 14, margin: '0 0 6px' }}>{t('ui.guide.title')}</h2>
      <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
        {items.map((item) => (
          <li
            key={item.step}
            style={{ marginBottom: 4, opacity: item.done ? 0.5 : 1, fontWeight: item.step === current ? 'bold' : 'normal' }}
          >
            {item.done ? '✓ ' : item.step === current ? '▶ ' : '　'}
            {t(STEP_KEY[item.step])}
          </li>
        ))}
      </ol>
    </section>
  );
}
