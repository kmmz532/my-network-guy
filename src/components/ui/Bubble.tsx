// 案内の吹き出し。紙の色の地に太い縁と影を付け、下に社員の方向を向く尻尾を持つ。wrap のときは文字を折り返す（スマホ）。中身は子が決める。
import type { ReactNode } from 'react';
import './tokens.css';
import './ui.css';

interface Props {
  wrap?: boolean;
  children: ReactNode;
}

export function Bubble({ wrap = false, children }: Props) {
  return (
    <div className={`ui-bubble${wrap ? ' ui-bubble--wrap' : ''}`}>
      {children}
      {/* 吹き出しの尻尾（社員の方向を向く） */}
      <span aria-hidden className="ui-bubble__tail" />
    </div>
  );
}
