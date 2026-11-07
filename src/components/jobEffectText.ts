// 職種の効果（内勤・システムエンジニア）の一行の文言。増分の数値を、画面の表示の形にする
import { t } from '../i18n/t';
import type { JobEffect } from '../sim/backOffice';

// 割合（0〜1）を、%の数値（小数1桁まで）にする
const percent = (v: number): string => (Math.round(v * 1000) / 10).toLocaleString('ja-JP', { maximumFractionDigits: 1 });

export const jobEffectText = (e: JobEffect): string => {
  switch (e.kind) {
    case 'sales':
      return t('ui.effect.job.sales', { pct: percent(e.chance) });
    case 'hr': {
      const rate = (Math.round(e.trainingRate * 100) / 100).toFixed(2);
      // 候補は人数が増えるときだけ書く（0人の増分は出さない）
      return e.candidates > 0 ? t('ui.effect.job.hr', { candidates: e.candidates, rate }) : t('ui.effect.job.hrTraining', { rate });
    }
    case 'accounting':
      return t('ui.effect.job.accounting', { pct: percent(e.rate) });
    case 'dev':
      return t('ui.effect.job.dev', { income: e.monthlyIncome.toLocaleString('ja-JP') });
  }
};
