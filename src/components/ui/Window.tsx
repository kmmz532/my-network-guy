// 動かせる窓の見た目。位置と大きさ（rect）で置き、題の帯・閉じる・タブの帯・中身を持つ。帯の高さは UI の大きさの倍率を受け、帯と中身の文字は zoom で拡大する。
// 動かす・大きさを変える処理は components/Window.tsx が持ち、ここへは指・マウスの処理（frameProps・barProps）と、辺と角の判定の欄（handles）だけを渡す。
// closeText を渡すと、閉じるのボタンは × の代わりにその文字を出す（スマホのパネルは「戻る」）。movable のときは右下に大きさを変えられる印を出す。
import type { HTMLAttributes, ReactNode } from 'react';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

interface Props {
  title: ReactNode;
  closeLabel: string;
  closeText?: string;
  onClose: () => void;
  rect: { x: number; y: number; w: number; h: number };
  movable: boolean;
  tabs?: ReactNode;
  frameProps?: Pick<HTMLAttributes<HTMLDivElement>, 'onPointerDownCapture' | 'onMouseDown'>;
  barProps?: Pick<HTMLAttributes<HTMLDivElement>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onAuxClick'>;
  handles?: ReactNode;
  layout?: Layout;
  children: ReactNode;
}

export function Window({ title, closeLabel, closeText, onClose, rect, movable, tabs, frameProps, barProps, handles, layout, children }: Props) {
  return (
    <div role="dialog" className="ui-window" style={{ ...layoutStyle(layout), left: rect.x, top: rect.y, width: rect.w, height: rect.h }} {...frameProps}>
      <div className={`ui-window__bar${movable ? ' ui-window__bar--movable' : ''}`} {...barProps}>
        <div className="ui-window__bar-inner">
          <span className="ui-window__title">{title}</span>
          <button
            type="button"
            className={`ui-window__close${closeText ? ' ui-window__close--text' : ''}`}
            aria-label={closeLabel}
            // 帯の移動を始めないよう、押した位置の処理を止める（止めないと、ボタンの上で移動が始まる）
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onClose}
          >
            {closeText ?? '×'}
          </button>
        </div>
      </div>
      {tabs}
      <div className="ui-window__body">
        {/* 中身はウィンドウの高さいっぱいまで伸ばせる（インベントリの枠など）。zoom を掛けるため、高さは倍率で割る */}
        <div className="ui-window__content">{children}</div>
      </div>
      {handles}
      {movable && <div aria-hidden="true" className="ui-window__grip" />}
    </div>
  );
}
