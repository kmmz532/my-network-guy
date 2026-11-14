// ファイルを選ぶボタン。Button と同じ見た目で、<input type="file"> を内側に隠す。選んだ1つのファイルを onFile へ渡す。
import type { ReactNode } from 'react';
import type { ButtonSize, ButtonVariant } from './Button';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

interface Props {
  variant: ButtonVariant;
  size?: ButtonSize;
  accept: string;
  onFile: (file: File) => void;
  layout?: Layout;
  children: ReactNode;
}

export function FileButton({ variant, size = 'm', accept, onFile, layout, children }: Props) {
  return (
    <label className={`ui-button ui-button--${variant} ui-button--${size} ui-button--file`} style={layoutStyle(layout)}>
      {children}
      <input
        type="file"
        accept={accept}
        className="ui-button__file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          // 同じファイルをもう一度選んでも onChange が出るよう、選びを空に戻す
          e.target.value = '';
        }}
      />
    </label>
  );
}
