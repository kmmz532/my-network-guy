// 今いる場所の札（N170）。マップの上端の中央に、常に「自社オフィス」か「現場: 依頼の名前」を出す。現場の札は依頼の色（黄）にする。
// 受注中の案件があるときは、札を押すと場所の一覧（自社オフィスと現場の案件）が開き、選んだ場所へ切り替える（N111・N169 の切り替えをここにまとめた）。
// 自社の案件（自社オフィスの写し）は、自社オフィスの行がその案件の設計を開く（名前に案件を添える）
import { useEffect, useRef, useState } from 'react';
import { t, tDyn } from '../i18n/t';
import { useGameStore } from '../stores/useGameStore';
import { Button } from './ui/Button';
import { Popover } from './ui/Popover';

export function PlaceLabel({ top }: { top: number }) {
  const active = useGameStore((s) => s.active);
  const focus = useGameStore((s) => s.focus);
  const setFocus = useGameStore((s) => s.setFocus);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const project = focus === null ? null : (active.find((p) => p.id === focus) ?? null);
  const site = project !== null && !project.contract.inhouse ? project : null;
  const inhouse = active.find((p) => p.contract.inhouse) ?? null;
  const titleOf = (p: (typeof active)[number]) => tDyn(`contract.${p.baseId}.title`, p.params);
  const items: { id: string | null; label: string; on: boolean }[] = [
    { id: inhouse ? inhouse.id : null, label: inhouse ? `${t('ui.focus.office')}・${titleOf(inhouse)}` : t('ui.focus.office'), on: site === null },
    ...active.filter((p) => p !== inhouse).map((p) => ({ id: p.id, label: t('ui.focus.site', { title: titleOf(p) }), on: p.id === focus })),
  ];
  const switchable = items.length > 1;

  // 一覧の外を押したら閉じる
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (box.current && e.target instanceof Node && box.current.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [open]);

  const label = site ? t('ui.focus.site', { title: titleOf(site) }) : t('ui.focus.office');
  return (
    <div ref={box} data-place-label style={{ position: 'absolute', top, left: '50%', transform: 'translateX(-50%)', zIndex: 5, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <Button variant="secondary" size="s" pressed={site !== null} guide="place" onClick={() => setOpen(switchable && !open)}>
        {label}
        {switchable && ' ▾'}
      </Button>
      {open && (
        <Popover variant="menu">
          <div role="group" aria-label={t('ui.focus.label')} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {items.map((i) => (
              <Button
                key={i.id ?? 'office'}
                variant="secondary"
                size="s"
                pressed={i.on}
                onClick={() => {
                  setFocus(i.id);
                  setOpen(false);
                }}
              >
                {i.label}
              </Button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}
