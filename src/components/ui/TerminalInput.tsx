// ターミナルの入力欄。入力の続きの予測を薄い文字で後ろに、誤りの語を下線で重ねて描く（ui.css の ui-terminal-input）。
// 入力欄の文字と重ね描きの文字は同じ書体・大きさで、重ね描きの入力の部分は透明にして下線と予測だけを見せる。
import type { KeyboardEvent } from 'react';
import './tokens.css';
import './ui.css';

interface Props {
  value: string;
  ghost: string; // 入力の後ろに薄く出す続き
  errorAt: number | null; // 下線を引く語の位置（なければ null）
  onChange: (value: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  label: string;
  placeholder: string;
}

export function TerminalInput({ value, ghost, errorAt, onChange, onKeyDown, label, placeholder }: Props) {
  const errorWord = errorAt === null ? '' : (/^\S+/.exec(value.slice(errorAt))?.[0] ?? '');
  return (
    <div className="ui-terminal-input">
      <div aria-hidden className="ui-terminal-input__mirror">
        <span className="ui-terminal-input__typed">
          {errorAt === null ? (
            value
          ) : (
            <>
              {value.slice(0, errorAt)}
              <span className="ui-terminal-input__error">{errorWord}</span>
              {value.slice(errorAt + errorWord.length)}
            </>
          )}
        </span>
        <span className="ui-terminal-input__ghost">{ghost}</span>
      </div>
      <input className="ui-terminal-input__field" aria-label={label} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} />
    </div>
  );
}
