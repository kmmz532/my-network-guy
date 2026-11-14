// セーブデータのJSONエクスポート・インポート（端末間の移行用）
import { SAVE_VERSION, isCompany, migrate } from './migrations';
import type { Company } from '../world/world';

const FORMAT = 'my-network-guy-save';

export const exportSave = (data: Company): string =>
  JSON.stringify({ format: FORMAT, saveVersion: SAVE_VERSION, data }, null, 2);

export const importSave = (text: string): Company => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('JSONとして読み込めない');
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('セーブデータの形式が不正');
  const file = parsed as { format?: unknown; saveVersion?: unknown; data?: unknown };
  if (file.format !== FORMAT) throw new Error('このアプリのセーブデータではない');
  const data = migrate(file.saveVersion as number, file.data);
  if (!isCompany(data)) throw new Error('セーブデータの形式が不正');
  return data;
};
