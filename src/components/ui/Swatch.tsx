// 色の見本（8 px の四角）。color は 0xRRGGBB。文の中に並べる。
import './tokens.css';
import './ui.css';

export function Swatch({ color }: { color: number }) {
  return <span className="ui-swatch" style={{ background: `#${color.toString(16).padStart(6, '0')}` }} />;
}
