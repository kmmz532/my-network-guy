// 解放された品目の名前と、機器・家具の札（絵・名前・台数）。結果画面（Overlay.tsx）と自社の情報の画面（CompanyPanel.tsx）で共有する（N66）
import { contractTemplates } from 'virtual:game-data';
import { pcCountRangeOf } from '../contracts/template';
import { tDyn } from '../i18n/t';
import { ItemIcon } from './ItemIcon';
import { Icon } from './Icon';
import { itemSpriteOf } from './itemSprite';
import { RADIUS } from '../ui/theme';

// 解放された品目の名前（機材・ケーブル・家具・依頼）
export const unlockNameOf = (x: { kind: 'device' | 'cable' | 'furniture' | 'template' | 'contract' | 'speed' | 'floor' | 'feature'; id: string }): string => {
  // 機能の解放（床の変更・夜勤の採用）。どの画面で使うかを名前に添える（N127）
  if (x.kind === 'feature') return tDyn(`ui.feature.${x.id}`);
  // 自社の床の種類（N92）。張り替えの解禁は、床の種類の名前で案内する
  if (x.kind === 'floor') return tDyn(`ui.floor.unlock.${x.id}`);
  // 早送りの速さ（N99）。名前は速さの表示（例:「4倍」）
  if (x.kind === 'speed') return tDyn(`ui.speed.${x.id}`);
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
          <ItemIcon name={itemSpriteOf(x.kind, x.id)} box={{ width: 36, height: 36 }} maxScale={2} />
          <span>
            {tDyn(`${x.kind}.${x.id}.name`)}
            {x.count !== undefined ? ` ×${x.count}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

// 解放の札の種類（N131）。種類ごとに同じ形の札（絵か印 + 名前）にする
export type UnlockCardKind = 'device' | 'cable' | 'furniture' | 'template' | 'contract' | 'speed' | 'floor' | 'feature' | 'expansion';

// 絵のない種類の印（アイコン）
const markOf: Record<Exclude<UnlockCardKind, 'device' | 'furniture'>, string> = {
  cable: 'icon/wire',
  template: 'icon/mail',
  contract: 'icon/mail',
  speed: 'icon/play',
  floor: 'icon/floor',
  feature: 'icon/feature',
  expansion: 'icon/expand',
};

// 解放の札の名前。部屋の拡張は、名前の鍵がないため文言で出す
const cardNameOf = (x: { kind: UnlockCardKind; id: string }): string => (x.kind === 'expansion' ? tDyn('report.levelUp.expansion') : unlockNameOf(x as { kind: Exclude<UnlockCardKind, 'expansion'>; id: string }));

// 解放の札を、種類ごとに同じ形で並べる。札は名前の途中で折り返さず、札の単位で折り返す（N131）
export function UnlockCards({ items }: { items: { kind: UnlockCardKind; id: string; count?: number }[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 4 }}>
      {items.map((x, i) => (
        <div
          key={`${x.kind}_${x.id}_${i}`}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', background: '#25406f', border: '1px solid #3b2a33', borderRadius: RADIUS.chrome, whiteSpace: 'nowrap' }}
        >
          {x.kind === 'device' || x.kind === 'furniture' ? (
            <ItemIcon name={itemSpriteOf(x.kind, x.id)} box={{ width: 36, height: 36 }} maxScale={2} />
          ) : (
            <Icon name={markOf[x.kind]} scale={1} />
          )}
          <span>
            {cardNameOf(x)}
            {x.count !== undefined ? ` ×${x.count}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}
