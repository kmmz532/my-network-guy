// 解放された品目の名前と、機器・家具の札（絵・名前・台数）。結果画面（Overlay.tsx）と自社の情報の画面（CompanyPanel.tsx）で共有する（N66）
import { contractTemplates } from 'virtual:game-data';
import { pcCountRangeOf } from '../contracts/template';
import { tDyn } from '../i18n/t';
import { Icon } from './Icon';
import { itemSpriteOf } from './itemSprite';
import { RADIUS } from '../ui/theme';

// 解放された品目の名前（機材・ケーブル・家具・依頼）
export const unlockNameOf = (x: { kind: 'device' | 'cable' | 'furniture' | 'template' | 'contract'; id: string }): string => {
  // 依頼のひな形は台数（{pcCount}）を範囲で入れる。依頼ごとの台数は決まっていないため
  if (x.kind === 'template') {
    const template = contractTemplates.find((c) => c.id === x.id);
    if (!template) throw new Error(`解放された依頼のひな形がない: ${x.id}`);
    const { min, max } = pcCountRangeOf(template);
    return tDyn(`contract.${x.id}.title`, { pcCount: min === max ? String(min) : `${min}〜${max}` });
  }
  if (x.kind === 'contract') return tDyn(`contract.${x.id}.title`);
  return tDyn(`${x.kind === 'device' ? 'device' : x.kind === 'cable' ? 'cable' : 'furniture'}.${x.id}.name`);
};

// 機器・家具の札（絵・名前・台数）。札は横に並び、収まらなければ折り返す
export function ItemCards({ items }: { items: { kind: 'device' | 'furniture'; id: string; count?: number }[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 4 }}>
      {items.map((x) => (
        <div key={`${x.kind}_${x.id}`} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', background: '#25406f', border: '1px solid #3b2a33', borderRadius: RADIUS.chrome }}>
          <Icon name={itemSpriteOf(x.kind, x.id)} scale={1} />
          <span>
            {tDyn(`${x.kind}.${x.id}.name`)}
            {x.count !== undefined ? ` ×${x.count}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}
