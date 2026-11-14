// 正方形の札（持ち物・解放される物の絵）。大きさの種類（item = インベントリの品目、unlock = 解放される物の絵）で辺の長さが決まる。
// 右下に数を出せる。絵は子で渡す。interactive を付けると押せる札（button）になり、押す・ドラッグの処理は呼び出し側が渡す。
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

export type TileSize = 'item' | 'unlock';

interface Props {
  size: TileSize;
  count?: number | string;
  // 選んでいる札は地と枠が変わる
  selected?: boolean;
  // 使えない札は薄く出す（押しても何もしない処理は呼び出し側が決める）
  unavailable?: boolean;
  interactive?: boolean;
  label?: string;
  onClick?: () => void;
  onPointerDown?: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  layout?: Layout;
  children: ReactNode;
}

export function Tile({ size, count, selected = false, unavailable = false, interactive = false, label, onClick, onPointerDown, layout, children }: Props) {
  const cls = ['ui-tile', `ui-tile--${size}`, interactive && 'ui-tile--button', selected && 'ui-tile--selected', unavailable && 'ui-tile--unavailable']
    .filter(Boolean)
    .join(' ');
  const body = (
    <>
      {children}
      {count !== undefined && <span className="ui-tile__count">{count}</span>}
    </>
  );
  if (!interactive) {
    return (
      <div className={cls} style={layoutStyle(layout)}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      style={layoutStyle(layout)}
      aria-label={label}
      aria-disabled={unavailable}
      onClick={onClick}
      onPointerDown={onPointerDown}
    >
      {body}
    </button>
  );
}
