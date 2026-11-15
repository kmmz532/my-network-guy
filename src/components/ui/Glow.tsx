// 案内で光らせる枠（緑・太さ 2 px・角は窓と同じ丸み）。ボタンの外側に重ね、点滅する。指の操作は通す。
// 位置と大きさは画面の px（box）で渡す。box の外側への出っ張りの分は呼び出し側が足す。zIndex は重なり順。
import './tokens.css';
import './ui.css';

interface Props {
  box: { left: number; top: number; width: number; height: number };
  zIndex: number;
}

export function Glow({ box, zIndex }: Props) {
  return <div aria-hidden className="ui-glow" style={{ left: box.left, top: box.top, width: box.width, height: box.height, zIndex }} />;
}
