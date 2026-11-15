// 画面の上に重ねて出す通知の札（給与の支払いなど）。文字は注意の黄。pressable は押すと開く画面がある札（指の形を変える）。
// action を渡すと、札の中に文字のボタンを出す（押して閉じるまで消えない通知の「開く」）。closeLabel を渡すと閉じる×を出す。×と action は札を押す処理を始めない。
import type { ReactNode } from 'react';
import './tokens.css';
import './ui.css';

interface Props {
  pressable: boolean;
  onPress: () => void;
  action?: { label: ReactNode; onClick: () => void };
  closeLabel?: string;
  onClose: () => void;
  children: ReactNode;
}

export function Toast({ pressable, onPress, action, closeLabel, onClose, children }: Props) {
  return (
    <div className={`ui-toast${pressable ? ' ui-toast--pressable' : ''}`} onClick={() => (pressable ? onPress() : undefined)}>
      {children}
      {action && (
        <button
          type="button"
          className="ui-toast__action"
          onClick={(e) => {
            e.stopPropagation();
            action.onClick();
          }}
        >
          {action.label}
        </button>
      )}
      {closeLabel !== undefined && (
        <button
          type="button"
          className="ui-toast__close"
          aria-label={closeLabel}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
