// 文中から別の窓を開く操作。地のない下線の文字。文字色は周りの文字に合わせる。
import type { ReactNode } from 'react';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

interface Props {
  onClick: () => void;
  // 周りの文字より目立たせる（注意を引く値）
  emphasis?: boolean;
  layout?: Layout;
  children: ReactNode;
}

export function Link({ onClick, emphasis = false, layout, children }: Props) {
  return (
    <button type="button" className={emphasis ? 'ui-link ui-link--emphasis' : 'ui-link'} onClick={onClick} style={layoutStyle(layout)}>
      {children}
    </button>
  );
}
