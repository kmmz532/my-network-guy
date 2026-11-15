// タブの帯の部品（Tabs が並べ方・キー操作・ドラッグを受け持つ）。
// Tab は 1 つのタブ（箱・ラベル・閉じる×）。tone は shop（パネルは暗い青）と window（機器・採用・ウィンドウの画面）で、選んでいるタブは下の縁がなく TabPanel と同じ色でつながる。選んでいないタブは一段暗く、下の縁がパネルとの境の線になる。
// TabArrow は帯の幅に収まらないときの送りの矢印、TabDropMark は並べ替えの挿入位置の印、TabPanel はタブの下に続けるパネル（上の縁はタブの下の縁に重ねる）。
import type { KeyboardEvent, MouseEvent, PointerEvent, ReactNode, Ref } from 'react';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

export type TabTone = 'shop' | 'window';

interface TabProps {
  tone: TabTone;
  // data-tab に入れる値。Tabs が選んだタブの位置を探すために使う
  tabId: string;
  active: boolean;
  disabled?: boolean;
  // 指定すると、タブの高さをこの px に固定する（中身が大きくても高さは変わらず、はみ出しは切る）
  height?: number;
  // ラベルのボタンの id（パネルの aria-labelledby 用）
  id?: string;
  labelRef: Ref<HTMLButtonElement>;
  icon?: ReactNode;
  label: ReactNode;
  // 閉じる×の読み上げ名と処理。両方あるときだけ×を出す
  closeLabel?: string;
  onClose?: () => void;
  onSelect: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  onPointerDown?: (e: PointerEvent<HTMLDivElement>) => void;
  onAuxClick?: (e: MouseEvent<HTMLDivElement>) => void;
}

export function Tab({ tone, tabId, active, disabled, height, id, labelRef, icon, label, closeLabel, onClose, onSelect, onKeyDown, onPointerDown, onAuxClick }: TabProps) {
  const closable = onClose !== undefined && closeLabel !== undefined;
  const cls = ['ui-tab', `ui-tab--${tone}`, active && 'ui-tab--active', closable && 'ui-tab--closable', disabled && 'ui-tab--disabled', height !== undefined && 'ui-tab--fixed'].filter(Boolean).join(' ');
  return (
    <div className={cls} data-tab={tabId} style={height === undefined ? undefined : { height }} onPointerDown={onPointerDown} onAuxClick={onAuxClick}>
      <button
        type="button"
        role="tab"
        className="ui-tab__label"
        id={id}
        ref={labelRef}
        aria-selected={active}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        tabIndex={active ? 0 : -1}
        onClick={onSelect}
        onKeyDown={onKeyDown}
      >
        {icon}
        <span className="ui-tab__text">{label}</span>
      </button>
      {closable && (
        <button
          type="button"
          className="ui-tab__close"
          aria-label={closeLabel}
          // タブを選ぶ処理を始めないよう、押した位置の処理を止める
          onPointerDown={(e) => e.stopPropagation()}
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

export function TabArrow({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="ui-tab-arrow" aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}

export function TabDropMark({ left }: { left: number }) {
  return <div aria-hidden="true" className="ui-tab-drop" style={{ left }} />;
}

// タブの下に続けるパネル（tone はタブの色と同じ）。id・role・aria は呼び出し側が渡す
export function TabPanel({ tone, id, labelledBy, layout, children }: { tone: TabTone; id?: string; labelledBy?: string; layout?: Layout; children: ReactNode }) {
  return (
    <div className={`ui-tab-panel ui-tab-panel--${tone}`} id={id} role={id ? 'tabpanel' : undefined} aria-labelledby={labelledBy} style={layoutStyle(layout)}>
      {children}
    </div>
  );
}
