import type { LangCode } from '../generated/ids';
import type { LangKey } from '../generated/lang-keys';
import { langLoaders } from 'virtual:loaders';

type Params = Record<string, string | number>;

let dict: Record<string, string> = {};
let current: LangCode | null = null;

// 言語を切り替える。選択中の言語ファイルだけを動的に読み込む
export async function loadLang(code: LangCode): Promise<void> {
  const loader = langLoaders[code];
  if (!loader) throw new Error(`言語 ${code} は存在しない`);
  dict = (await loader()).default;
  current = code;
}

export function currentLang(): LangCode | null {
  return current;
}

// {name} 形式の名前付き置換を行う
export function t(key: LangKey, params: Params = {}): string {
  const template = dict[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

// 翻訳キーがあるか（任意の文言がない案件などで使う）
export function hasKey(key: string): boolean {
  return key in dict;
}
