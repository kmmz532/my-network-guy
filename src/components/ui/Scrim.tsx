// 狭い画面で窓を開いている間、後ろを暗くする幕。押すと窓を閉じる処理を onClick で渡す。親の全面を覆う。
import './tokens.css';
import './ui.css';

export function Scrim({ onClick }: { onClick: () => void }) {
  return <div aria-hidden className="ui-scrim" onClick={onClick} />;
}
