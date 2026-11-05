// ポップアップの枠。背景を暗くして中央に出し、Esc で閉じ、Enter で主のボタンを押す（入力の登録は input/popupStack.ts）。
// 主のボタンは、子の部品が usePrimary で指定する（一番上のポップアップの主のボタンになる）。
import { createContext, useCallback, useContext, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { pushPopup, type PopupEntry } from '../input/popupStack';

export const modalBack = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(20, 20, 30, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10,
  zoom: 'var(--ui-scale, 1)',
} as const;

export const modalBox = {
  background: '#2f4f8f',
  color: '#f4f1e6',
  padding: 16,
  borderRadius: 6,
  border: '2px solid #f4f1e6',
  // 画面の幅は、背景（modalBack）の幅に対する割合で決める（vw は UI の大きさの倍率を受けるため使わない）
  maxWidth: 'calc(100% - 32px)',
} as const;

// 主のボタンの見た目（背景の色で、ほかのボタンと見分ける）
export const primaryButton = {
  padding: '4px 16px',
  cursor: 'pointer',
  background: '#ffd866',
  color: '#3b2a33',
  border: '1px solid #3b2a33',
  borderRadius: 3,
  fontWeight: 'bold',
} as const;

type SetPrimary = (run: (() => void) | undefined) => void;
const PopupContext = createContext<SetPrimary | null>(null);

interface Props {
  // 閉じる処理（背景を押したとき・Esc）。なければ閉じられない
  onClose?: () => void;
  // Enter で押す主のボタン（子の部品から指定する場合は usePrimary を使う）
  primary?: () => void;
  // 背景と箱の見た目を差し替える（破産の画面など）
  backStyle?: CSSProperties;
  boxStyle?: CSSProperties;
  children: ReactNode;
}

export function Modal({ onClose, primary, backStyle, boxStyle, children }: Props) {
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
      <div style={{ ...modalBack, ...backStyle }} onClick={onClose}>
        <div style={{ ...modalBox, ...boxStyle }} onClick={(e) => e.stopPropagation()}>
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
