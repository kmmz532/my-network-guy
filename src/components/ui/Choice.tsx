// 並んだ択一のボタン。選んでいるものは反転した見た目になる。同じ幅・同じ高さの箱にそろえ、折り返しても段の高さがそろう。
import { Button } from './Button';
import './ui.css';

export interface ChoiceOption<T> {
  value: T;
  label: string;
}

interface Props<T> {
  options: ChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function Choice<T extends string | number | boolean>({ options, value, onChange }: Props<T>) {
  return (
    <div className="ui-choice">
      {options.map((o) => (
        <Button key={String(o.value)} variant="outline" size="choice" pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </Button>
      ))}
    </div>
  );
}
