// 家具の効果を1行の文言にする（例:「近くの席の施工力 +10%」）。ショップの説明とマップのツールチップで使う
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';

export const effectText = (effect: { stat: 'power' | 'exp' | 'seatless'; value: number; range?: number } | undefined): string | null => {
  if (!effect) return null;
  if (effect.stat === 'seatless') return t('ui.effect.seatless', { value: effect.value });
  const percent = Math.round(effect.value * 100);
  const place = effect.range === undefined ? 'all' : 'near';
  return t(`ui.effect.${effect.stat}.${place}` as LangKey, { percent });
};
