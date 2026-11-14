// 操作を止めて答えを求める窓。背景の幕・Esc・Enter は Modal が受け持つ（入力の登録は input/popupStack.ts）。
// 窓の見た目（段階1・縁・幕）は Modal の枠が持つ。primary は Enter で押す主の操作。
import type { ReactNode } from 'react';
import { Modal } from '../Modal';
import './tokens.css';
import './ui.css';

interface Props {
  onClose?: () => void;
  primary?: () => void;
  children: ReactNode;
}

export function Dialog({ onClose, primary, children }: Props) {
  return (
    <Modal onClose={onClose} primary={primary}>
      {children}
    </Modal>
  );
}
