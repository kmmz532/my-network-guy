// 窓の見た目（段階1）。題の帯・閉じる・中身。動かす・大きさを変える処理は components/Window.tsx が持つ。
import type { ReactNode } from 'react';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

interface Props {
  title: ReactNode;
  closeLabel: string;
  onClose: () => void;
  layout?: Layout;
  children: ReactNode;
}

export function Window({ title, closeLabel, onClose, layout, children }: Props) {
  return (
    <div className="ui-window" style={layoutStyle(layout)}>
      <div className="ui-window__bar">
        <div className="ui-window__title">{title}</div>
        <button type="button" className="ui-window__close" aria-label={closeLabel} onClick={onClose}>
          ×
        </button>
      </div>
      <div className="ui-window__body">{children}</div>
    </div>
  );
}
