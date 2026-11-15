// ターミナルの出力の欄。窪みの地に、1 行ずつ固定幅の文字で並べる（高さは固定で、はみ出しは縦に送る）。warn の行は注意の黄。
// 出力は読み上げに知らせ、文字の選択とコピーを許す（data-terminal-output）。
import './tokens.css';
import './ui.css';

export interface OutputLine {
  text: string;
  warn: boolean;
}

export function TerminalOutput({ lines }: { lines: readonly OutputLine[] }) {
  return (
    <div aria-live="polite" data-terminal-output className="ui-terminal-output">
      {lines.map((l, i) => (
        <div key={i} className={l.warn ? 'ui-terminal-output__line ui-terminal-output__line--warn' : 'ui-terminal-output__line'}>
          {l.text}
        </div>
      ))}
    </div>
  );
}
