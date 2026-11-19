// 失敗の理由・案内の手順・設定の部品・達成条件と用語集の対応: 対応先の用語が言語ファイルにあること、引く関数の結果
import { describe, expect, it } from 'vitest';
import langJson from '../assets/lang/ja_jp.json';
import { GLOSSARY_OF_FAILURE, GLOSSARY_OF_GOAL, GLOSSARY_OF_SETTING, GLOSSARY_OF_STEP, termOfGoal, termOfSettings, termOfStep, termsOfLesson } from './glossaryOf';

const dict = langJson as Record<string, string>;

describe('失敗の理由と用語集', () => {
  it('対応する用語は、言語ファイルの glossary.<ID> にある', () => {
    for (const [reason, id] of Object.entries(GLOSSARY_OF_FAILURE)) {
      expect(dict[`glossary.${id}`], reason).toBeTruthy();
      expect(dict[`termName.${id}`], reason).toBeTruthy();
    }
  });
});

describe('手順・設定の部品・達成条件と用語集', () => {
  it('対応する用語は、言語ファイルにある。手順の文言のキーも実在する', () => {
    for (const [key, id] of Object.entries(GLOSSARY_OF_STEP)) {
      expect(dict[key], key).toBeTruthy();
      expect(dict[`glossary.${id}`], key).toBeTruthy();
      expect(dict[`termName.${id}`], key).toBeTruthy();
    }
    for (const [capability, id] of GLOSSARY_OF_SETTING) {
      expect(dict[`glossary.${id}`], capability).toBeTruthy();
      expect(dict[`termName.${id}`], capability).toBeTruthy();
    }
    for (const [type, id] of Object.entries(GLOSSARY_OF_GOAL)) {
      expect(dict[`glossary.${id}`], type).toBeTruthy();
      expect(dict[`termName.${id}`], type).toBeTruthy();
    }
  });

  it('対応のない手順・達成条件は null を返す', () => {
    expect(termOfStep('lesson.ospf_intro.step.1')).toBeNull();
    expect(termOfGoal('ping')).toBeNull();
    expect(termOfStep('lesson.vrrp_pair.step.2')).toBe('vrrp');
    expect(termOfGoal('lag_bundled')).toBe('lacp');
  });

  it('設定の欄では、持つ部品のうち、まだ出していない最初の用語を返す', () => {
    const has = (c: string) => c === 'vrrp' || c === 'bgp';
    expect(termOfSettings(has, [])).toBe('vrrp');
    expect(termOfSettings(has, ['vrrp'])).toBe('as_number');
    expect(termOfSettings(has, ['vrrp', 'as_number'])).toBeNull();
    expect(termOfSettings(() => false, [])).toBeNull();
  });

  it('教材を開いている間は、その論点の用語だけを設定の欄で返す', () => {
    const has = (c: string) => c === 'vrrp' || c === 'bgp';
    expect(termOfSettings(has, [], termsOfLesson('ospf_intro'))).toBeNull();
    expect(termOfSettings(has, [], termsOfLesson('vrrp_pair'))).toBe('vrrp');
    expect(termOfSettings(has, [], undefined)).toBe('vrrp');
  });
});
