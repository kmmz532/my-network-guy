// 画面全体を占める面（描画の例外の画面）。地は札の色で、書体はゲームの書体が読めなくても出せるよう標準の書体にする。
// CodeBlock は、折り返す固定幅の欄（例外の内容）。幅の上限などの配置は layout で渡す。
import type { ReactNode } from 'react';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

export function Screen({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="ui-screen">
      {children}
    </div>
  );
}

export function CodeBlock({ layout, children }: { layout?: Layout; children: ReactNode }) {
  return (
    <pre className="ui-code-block" style={layoutStyle(layout)}>
      {children}
    </pre>
  );
}
