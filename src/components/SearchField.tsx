// 検索の欄（N67）。ショップとインベントリの上に置く。入力中はゲームのキー操作を止める（keymap.ts の入力欄の扱い）。Esc で文字を消す
// 外側に余白を置かず、板の幅いっぱいにする。左端の虫めがねは飾りのため、読み上げの対象から外す（N128）
import { t } from '../i18n/t';
import { Icon } from './Icon';
import { SearchInput } from './ui/SearchInput';

export function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <SearchInput value={value} onChange={onChange} placeholder={t('ui.search.placeholder')} label={t('ui.search.label')} icon={<Icon name="icon/search" scale={1} />} />;
}
