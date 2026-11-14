// 一覧の行（1行で1件を表す）。中身は縦に並べる。選ばれた行は黄の枠（active）、使えない行は薄く出す（disabled）。
// onClick を渡すと行の全体が押せる（button になる）。押したときの処理は呼び出し側が決める。
import type { ReactNode } from 'react';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

interface Props {
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  layout?: Layout;
  children: ReactNode;
}

export function ListRow({ active = false, disabled = false, onClick, layout, children }: Props) {
  const cls = `ui-list-row${active ? ' ui-list-row--active' : ''}${disabled ? ' ui-list-row--disabled' : ''}${onClick ? ' ui-list-row--button' : ''}`;
  if (onClick) {
    return (
      <button type="button" className={cls} style={layoutStyle(layout)} onClick={onClick}>
        {children}
      </button>
    );
  }
  return <div className={cls} style={layoutStyle(layout)}>{children}</div>;
}
