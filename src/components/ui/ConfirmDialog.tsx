// はい・いいえの確認の窓。本文と、取り消し・操作の2つのボタンを並べる。
// tone が danger（削除・上書きなど）のときは取り消しが主の操作（Enter・Esc）。primary のときは操作が主で、取り消しは secondary。
import type { ReactNode } from 'react';
import { usePrimary } from '../Modal';
import { Dialog } from './Dialog';
import { Button } from './Button';
import './tokens.css';
import './ui.css';

export interface ConfirmAction {
  label: string;
  onClick: () => void;
  tone: 'danger' | 'primary';
}

interface Props {
  onCancel: () => void;
  cancelLabel: string;
  action: ConfirmAction;
  children: ReactNode;
}

// Enter の主の操作は、Modal の子の部品から指定する（usePrimary は Modal の中でだけ使える）
function Body({ onCancel, cancelLabel, action, children }: Props) {
  usePrimary(action.tone === 'primary' ? action.onClick : onCancel);
  return (
    <div className="ui-confirm">
      <div>{children}</div>
      <div className="ui-confirm__actions">
        <Button variant={action.tone === 'danger' ? 'primary' : 'secondary'} onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button variant={action.tone} onClick={action.onClick}>
          {action.label}
        </Button>
      </div>
    </div>
  );
}

export function ConfirmDialog({ onCancel, cancelLabel, action, children }: Props) {
  return (
    <Dialog onClose={onCancel}>
      <Body onCancel={onCancel} cancelLabel={cancelLabel} action={action}>
        {children}
      </Body>
    </Dialog>
  );
}
