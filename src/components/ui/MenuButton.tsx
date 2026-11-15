// タイトルの縦に並ぶメニューのボタン。選んでいる項目は黄の地で左に三角の印が付く。onHover は指す（マウスを乗せる）処理。
import type { ReactNode } from 'react';
import './tokens.css';
import './ui.css';

interface Props {
  selected: boolean;
  disabled: boolean;
  onHover: () => void;
  onClick: () => void;
  children: ReactNode;
}

export function MenuButton({ selected, disabled, onHover, onClick, children }: Props) {
  return (
    <button type="button" className={`ui-menu-button${selected ? ' ui-menu-button--selected' : ''}`} disabled={disabled} onMouseEnter={onHover} onClick={onClick}>
      {children}
    </button>
  );
}
