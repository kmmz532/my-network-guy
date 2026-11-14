// 部品へ配置だけを渡す prop。見た目（色・枠・文字）は渡せない。
import type { CSSProperties } from 'react';

export interface Layout {
  margin?: CSSProperties['margin'];
  marginTop?: CSSProperties['marginTop'];
  marginRight?: CSSProperties['marginRight'];
  marginBottom?: CSSProperties['marginBottom'];
  marginLeft?: CSSProperties['marginLeft'];
  width?: CSSProperties['width'];
  minWidth?: CSSProperties['minWidth'];
  maxWidth?: CSSProperties['maxWidth'];
  minHeight?: CSSProperties['minHeight'];
  maxHeight?: CSSProperties['maxHeight'];
  overflowY?: CSSProperties['overflowY'];
  flex?: CSSProperties['flex'];
  flexShrink?: CSSProperties['flexShrink'];
  alignSelf?: CSSProperties['alignSelf'];
}

// 配置を style の値にする（部品の内側でだけ使う）
export const layoutStyle = (layout: Layout | undefined): CSSProperties => ({ ...layout });
