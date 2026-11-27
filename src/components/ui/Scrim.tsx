// 後ろを暗くする幕。親の全面を覆う。
// onClick を渡すと、狭い画面で窓を開いている間の幕になり、押すと窓を閉じる。fade（0〜1 の濃さ）を渡すと、画面全体を覆い指の操作を通す演出の幕になる（場所の切り替え）
import './tokens.css';
import './ui.css';

type Props = { onClick: () => void; fade?: undefined } | { onClick?: undefined; fade: number; zIndex: number };

export function Scrim(props: Props) {
  if (props.fade !== undefined) return <div aria-hidden className="ui-scrim ui-scrim--fade" style={{ opacity: props.fade, zIndex: props.zIndex }} />;
  return <div aria-hidden className="ui-scrim" onClick={props.onClick} />;
}
