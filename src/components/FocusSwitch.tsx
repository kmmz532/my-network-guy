// 自社オフィスを見ているときに出す、オフィスの画面（外部への接続・床・プリンター・貸し出し）を開くボタン（N126）。
// 場所の切り替え（N111・N169）は、マップの上端の場所の札（PlaceLabel.tsx）にまとめた
import { t } from '../i18n/t';
import { useGameStore } from '../stores/useGameStore';
import { Button } from './ui/Button';

export function FocusSwitch() {
  const active = useGameStore((s) => s.active);
  const focus = useGameStore((s) => s.focus);
  const openWindow = useGameStore((s) => s.openWindow);
  // 案件がなければ、今までどおり出さない
  if (active.length === 0) return null;
  const inhouse = active.find((p) => p.contract.inhouse) ?? null;
  const officeOn = inhouse ? focus === inhouse.id || focus === null : focus === null;
  if (!officeOn) return null;
  return (
    <Button variant="secondary" size="s" onClick={() => openWindow('office', '')}>
      {t('ui.office.open')}
    </Button>
  );
}
