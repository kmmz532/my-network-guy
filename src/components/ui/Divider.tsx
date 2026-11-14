// 上の帯・ツールバーの中の縦の区切り線（幅 1 px・高さ 36 px）。余白は layout で渡す。
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

interface Props {
  layout?: Layout;
}

export function Divider({ layout }: Props) {
  return <span className="ui-divider" style={layoutStyle(layout)} />;
}
