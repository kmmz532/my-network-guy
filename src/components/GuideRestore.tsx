// しまった案内を戻す札（ボタンは札の行の高さに合わせて 28 px にし、顔をボタンいっぱいに描く）。案件の欄の見出しの行に、社員の顔の小さなボタンと「次: <今の手順の1行>」を出す。押すと吹き出しに戻る
import { t, tDyn } from '../i18n/t';
import { staffSpriteName } from '../data/schema';
import { useGameStore } from '../stores/useGameStore';
import { Icon } from './Icon';
import { IconButton } from './ui/IconButton';
import { Text } from './ui/Text';

export function GuideRestore() {
  const shelved = useGameStore((s) => s.guideShelved);
  // 吹き出しと同じ顔の絵（社員のいないサンドボックスでは既定の見た目）
  const staffLook = useGameStore((s) => staffSpriteName(s.staff[0]?.look ?? 'blue'));
  const setGuideHidden = useGameStore((s) => s.setGuideHidden);
  if (shelved === null) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, paddingLeft: 6 }}>
      <IconButton label={t('ui.guide.restore')} onClick={() => setGuideHidden(shelved.id, false)} layout={{ flexShrink: 0, width: 28, minHeight: 28, maxHeight: 28 }}>
        <Icon name={`staff/${staffLook}_0`} scale={1} />
      </IconButton>
      <div style={{ minWidth: 0, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}>
        <Text as="span" tone="soft" size="s">{t('ui.guide.next', { text: tDyn(shelved.key) })}</Text>
      </div>
    </div>
  );
}
