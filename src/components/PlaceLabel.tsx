// 今いる場所の札（N170）。マップの上端の中央に、常に「自社オフィス」か「現場: 依頼の名前」を出す。
// 現場の札は依頼の色（選んだ切り替えのタブと同じ黄）にし、押すと自社オフィスへ戻る。自社オフィスでは押しても何もしない
import { t, tDyn } from '../i18n/t';
import { useGameStore } from '../stores/useGameStore';
import { Button } from './ui/Button';

export function PlaceLabel({ top }: { top: number }) {
  const active = useGameStore((s) => s.active);
  const focus = useGameStore((s) => s.focus);
  const setFocus = useGameStore((s) => s.setFocus);
  const project = focus === null ? null : (active.find((p) => p.id === focus) ?? null);
  const site = project !== null && !project.contract.inhouse ? project : null;
  // 自社の案件があれば、自社オフィスへ戻るときもその案件の設計を開く（FocusSwitch と同じ）
  const inhouse = active.find((p) => p.contract.inhouse) ?? null;
  return (
    <div data-place-label style={{ position: 'absolute', top, left: '50%', transform: 'translateX(-50%)', zIndex: 5 }}>
      {site ? (
        <Button variant="secondary" size="s" pressed onClick={() => setFocus(inhouse ? inhouse.id : null)}>
          {t('ui.focus.site', { title: tDyn(`contract.${site.baseId}.title`, site.params) })}
        </Button>
      ) : (
        <Button variant="secondary" size="s" onClick={() => undefined}>
          {t('ui.focus.office')}
        </Button>
      )}
    </div>
  );
}
