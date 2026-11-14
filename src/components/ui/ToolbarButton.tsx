// 上の帯の文字の小さいボタン（停止・再生・早送り・メニュー）。文字と絵を子で渡す。on は今の操作（選んでいる速さ）で、黄の地になる。
// label は必須で、aria-label になる。tip を省くと label を吹き出しにする。スマホでは指で押せるよう、最小の大きさ（28 px）を取る。
import type { ReactNode } from 'react';
import { Tooltip, hideTip } from '../Tooltip';
import { usePhone } from '../../ui/usePhone';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

interface Props {
  label: string;
  tip?: string;
  on?: boolean;
  onClick: () => void;
  layout?: Layout;
  children: ReactNode;
}

export function ToolbarButton({ label, tip, on = false, onClick, layout, children }: Props) {
  const phone = usePhone();
  const cls = ['ui-toolbar-button', on && 'ui-toolbar-button--on', phone && 'ui-toolbar-button--phone'].filter(Boolean).join(' ');
  return (
    <Tooltip text={tip ?? label}>
      <button
        type="button"
        aria-label={label}
        className={cls}
        onClick={() => { hideTip(); onClick(); }}
        style={layoutStyle(layout)}
      >
        {children}
      </button>
    </Tooltip>
  );
}
