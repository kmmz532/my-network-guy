// 操作を止めて答えを求める窓。背景の幕・Esc・Enter は Modal が受け持つ（入力の登録は input/popupStack.ts）。
// 窓の見た目（段階1・縁・幕）は Modal の枠が持つ。primary は Enter で押す主の操作。窓の大きさは layout で渡す。
import type { ReactNode } from 'react';
import { Modal } from '../Modal';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

interface Props {
  onClose?: () => void;
  primary?: () => void;
  layout?: Layout;
  children: ReactNode;
}

export function Dialog({ onClose, primary, layout, children }: Props) {
  return (
    <Modal onClose={onClose} primary={primary} boxStyle={layoutStyle(layout)}>
      {children}
    </Modal>
  );
}
