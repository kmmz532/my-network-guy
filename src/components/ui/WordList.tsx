// 語の一覧。Tab で出す候補を並べ、選んでいる語を太字と下線で示す（ui.css の ui-word-list）。
import './tokens.css';
import './ui.css';

interface Props {
  words: readonly string[];
  selected: number; // 選んでいる語の位置（なければ -1）
}

export function WordList({ words, selected }: Props) {
  return (
    <div aria-live="polite" className="ui-word-list">
      {words.map((word, i) => (
        <span key={word} className={i === selected ? 'ui-word-list__word ui-word-list__word--selected' : 'ui-word-list__word'}>
          {word}
        </span>
      ))}
    </div>
  );
}
