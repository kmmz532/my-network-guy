// 画面全体を覆い、操作を止めて知らせる札（別のタブで開いているときの表示）。地を暗くして中央に札を出す。札の中身は子が決める。
import type { ReactNode } from 'react';
import './tokens.css';
import './ui.css';

export function Blocker({ children }: { children: ReactNode }) {
  return (
    <div role="alertdialog" aria-modal="true" className="ui-blocker">
      <div className="ui-blocker__panel">{children}</div>
    </div>
  );
}
