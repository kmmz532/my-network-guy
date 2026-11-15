// 背面の差し込み口のボタン。地も枠も持たず、状態を枠と明るさで示す。
// mark: selected は選んだ口（黄の実線）、target は挿し替え先の候補（黄の破線）。tone: lift は明るく、dim は暗く、glow は光らせる。grab は掴める口（カーソルの形）。
import type { DragEvent, PointerEvent, ReactNode, Ref } from 'react';
import './tokens.css';
import './ui.css';

interface Props {
  label: string;
  mark?: 'selected' | 'target';
  tone?: 'lift' | 'dim' | 'glow';
  grab?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  onClick: () => void;
  onPointerDown?: (e: PointerEvent<HTMLButtonElement>) => void;
  onDragStart?: (e: DragEvent<HTMLButtonElement>) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  children: ReactNode;
}

export function PortButton({ label, mark, tone, grab = false, buttonRef, onClick, onPointerDown, onDragStart, onMouseEnter, onMouseLeave, children }: Props) {
  const cls = ['ui-port-button', mark && `ui-port-button--${mark}`, tone && `ui-port-button--${tone}`, grab && 'ui-port-button--grab'].filter(Boolean).join(' ');
  return (
    <button ref={buttonRef} type="button" className={cls} aria-label={label} onClick={onClick} onPointerDown={onPointerDown} onDragStart={onDragStart} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      {children}
    </button>
  );
}
