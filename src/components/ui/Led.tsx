// 口の点灯（LED）。色と大きさ（px）は呼び出し側が渡す（機器の定義の色・画面の拡大率で変わるため、トークンにしない）。
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

interface Props {
  color: string;
  size: number;
  layout?: Layout;
}

export function Led({ color, size, layout }: Props) {
  return <span className="ui-led" style={{ ...layoutStyle(layout), width: size, height: size, background: color }} />;
}
