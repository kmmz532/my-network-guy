// プラグの絵の上に重ねる、つながったネットワークの色の縞。colors は 0xRRGGBB の並び（2色以上なら縦縞）、mask はプラグの形の画像の URL。
// 上の親（position: relative）の全面に重ね、押しは通す。more は 4 本以上あることを示す「…」（scale は絵の拡大率）。
import './tokens.css';
import './ui.css';

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

const fillOf = (colors: number[]): string =>
  colors.length > 1
    ? `repeating-linear-gradient(90deg, ${colors.map((c, i) => `${hex(c)} ${(i * 100) / colors.length}% ${((i + 1) * 100) / colors.length}%`).join(', ')})`
    : hex(colors[0]);

export function PlugStripe({ colors, mask }: { colors: number[]; mask: string }) {
  const url = `url(${mask})`;
  return <span className="ui-plug-stripe" style={{ background: fillOf(colors), maskImage: url, WebkitMaskImage: url }} />;
}

export function PlugMore({ scale }: { scale: number }) {
  return <span className="ui-plug-more" style={{ fontSize: Math.max(8, scale * 3) }}>…</span>;
}
