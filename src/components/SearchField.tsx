// 検索の欄（N67）。ショップとインベントリの上に置く。入力中はゲームのキー操作を止める（keymap.ts の入力欄の扱い）。Esc で文字を消す
// 外側に余白を置かず、板の幅いっぱいにする。左端の虫めがねは飾りのため、読み上げの対象から外す（N128）
import { t } from '../i18n/t';
import { RADIUS } from '../ui/theme';
import { Icon } from './Icon';

export function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div style={{ position: 'relative' }}>
      <span aria-hidden="true" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', display: 'flex' }}>
        <Icon name="icon/search" scale={1} />
      </span>
      <input
        data-search
        type="search"
        value={value}
        placeholder={t('ui.search.placeholder')}
        aria-label={t('ui.search.label')}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // 文字がある間の Esc は、ウィンドウを閉じる操作ではなく文字を消す操作にする
          if (e.key === 'Escape' && value !== '') {
            e.preventDefault();
            e.stopPropagation();
            onChange('');
          }
        }}
        style={{ width: '100%', boxSizing: 'border-box', padding: '4px 8px 4px 30px', background: '#1e3260', color: '#f4f1e6', border: '1px solid #3b2a33', borderRadius: RADIUS.none, font: 'inherit' }}
      />
    </div>
  );
}
