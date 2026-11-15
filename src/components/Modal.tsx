// ポップアップの枠。背景を暗くして中央に出し、Esc で閉じ、Enter で主のボタンを押す（入力の登録は input/popupStack.ts）。
// 主のボタンは、子の部品が usePrimary で指定する（一番上のポップアップの主のボタンになる）。
import { createContext, useCallback, useContext, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { pushPopup, type PopupEntry } from '../input/popupStack';
import './ui/tokens.css';
import './ui/ui.css';

type SetPrimary = (run: (() => void) | undefined) => void;
const PopupContext = createContext<SetPrimary | null>(null);

interface Props {
  // 閉じる処理（背景を押したとき・Esc）。なければ閉じられない
  onClose?: () => void;
  // Enter で押す主のボタン（子の部品から指定する場合は usePrimary を使う）
  primary?: () => void;
  // screen は箱を持たない全画面の幕（破産の画面）。既定は窓の箱
  variant?: 'dialog' | 'screen';
  boxStyle?: CSSProperties;
  children: ReactNode;
}

export function Modal({ onClose, primary, variant = 'dialog', boxStyle, children }: Props) {
  const latestClose = useRef(onClose);
  const entry = useRef<PopupEntry>({});
  useEffect(() => {
    latestClose.current = onClose;
    entry.current.close = onClose ? () => latestClose.current?.() : undefined;
  });
  useEffect(() => pushPopup(entry.current), []);
  const setPrimary = useCallback<SetPrimary>((run) => {
    entry.current.primary = run;
  }, []);
  useEffect(() => {
    if (!primary) return;
    setPrimary(primary);
    return () => setPrimary(undefined);
  });
  return (
    <PopupContext.Provider value={setPrimary}>
      <div className={variant === 'screen' ? 'ui-modal-back ui-modal-back--screen' : 'ui-modal-back'} onClick={onClose}>
        <div className={variant === 'screen' ? 'ui-modal-box ui-modal-box--bare' : 'ui-modal-box'} style={boxStyle} onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      </div>
    </PopupContext.Provider>
  );
}

// 子の部品から主のボタンを指定する。run が空（undefined）の部品は何もしない（複数の部品から指定するときは、1つだけ run を渡す）
export function usePrimary(run: (() => void) | undefined): void {
  const set = useContext(PopupContext);
  useEffect(() => {
    if (!set || !run) return;
    set(run);
    return () => set(undefined);
  });
}
