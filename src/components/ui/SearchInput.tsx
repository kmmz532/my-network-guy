// 検索の欄。暗い地の入力欄の左端に、飾りの絵（icon）を重ねる。幅は親いっぱい。data-search は検索の欄へ移るキー（ui/focusSearch.ts）の目印。
// 文字がある間の Esc は、窓を閉じる操作ではなく文字を消す操作にする。
import type { ReactNode } from 'react';
import './tokens.css';
import './ui.css';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  icon: ReactNode;
}

export function SearchInput({ value, onChange, placeholder, label, icon }: Props) {
  return (
    <div className="ui-search-input">
      <span aria-hidden="true" className="ui-search-input__icon">
        {icon}
      </span>
      <input
        data-search
        type="search"
        className="ui-search-input__field"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value !== '') {
            e.preventDefault();
            e.stopPropagation();
            onChange('');
          }
        }}
      />
    </div>
  );
}
