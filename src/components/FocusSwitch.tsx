// 画面の対象の切り替え（N111・N169）。自社オフィスと、現場の案件（自分の設計・任せた依頼）を行き来できる。
// 自社の案件（自社オフィスの写し）は、自社オフィスのタブがその案件の設計を開く（タブは1つにまとめ、名前に案件を添える・N169）
import { t, tDyn } from '../i18n/t';
import { useGameStore } from '../stores/useGameStore';
import { Button } from './ui/Button';

export function FocusSwitch() {
  const active = useGameStore((s) => s.active);
  const focus = useGameStore((s) => s.focus);
  const setFocus = useGameStore((s) => s.setFocus);
  const openWindow = useGameStore((s) => s.openWindow);
  // 案件がなければ、自社オフィスしかないため出さない
  if (active.length === 0) return null;
  const inhouse = active.find((p) => p.contract.inhouse) ?? null;
  const others = active.filter((p) => p !== inhouse);
  // 自社オフィスのタブ: 自社の案件があれば、その案件の設計を開く。名前に案件を添える
  const officeLabel = inhouse ? `${t('ui.focus.office')}・${tDyn(`contract.${inhouse.baseId}.title`, inhouse.params)}` : t('ui.focus.office');
  const officeOn = inhouse ? focus === inhouse.id || focus === null : focus === null;
  const items: { id: string | null; label: string; on: boolean }[] = [
    { id: inhouse ? inhouse.id : null, label: officeLabel, on: officeOn },
    ...others.map((p) => ({ id: p.id, label: tDyn(`contract.${p.baseId}.title`, p.params), on: p.id === focus })),
  ];
  return (
    <div role="group" aria-label={t('ui.focus.label')} style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {items.map((i) => (
        <Button key={i.id ?? 'office'} variant="secondary" size="s" pressed={i.on} onClick={() => setFocus(i.id)}>
          {i.label}
        </Button>
      ))}
      {/* 自社オフィスを見ているときは、オフィスの画面（外部への接続・床・プリンター・貸し出し）を開く（N126） */}
      {officeOn && (
        <Button variant="secondary" size="s" onClick={() => openWindow('office', '')}>
          {t('ui.office.open')}
        </Button>
      )}
    </div>
  );
}
