// 色の見本（8 px の四角）。color は 0xRRGGBB。文の中に並べる。framed は枠つきの 10 px の四角（設定の画面の、ネットワークの色）。
import './tokens.css';
import './ui.css';

export function Swatch({ color, framed = false }: { color: number; framed?: boolean }) {
  return <span className={`ui-swatch${framed ? ' ui-swatch--framed' : ''}`} style={{ background: `#${color.toString(16).padStart(6, '0')}` }} />;
}
