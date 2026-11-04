// セーブデータのバージョン管理。形式を変えたら SAVE_VERSION を上げ、migrations[n]（n → n+1 の変換）を追加する。
export const SAVE_VERSION = 1;

export interface SaveData {
  clock: { minute: number; money: number; paidMonths: number; bankrupt: boolean };
  reputation: number;
}

type Migration = (data: unknown) => unknown;

export const migrations: Record<number, Migration> = {};

export const isSaveData = (value: unknown): value is SaveData => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const clock = v.clock as Record<string, unknown> | undefined;
  return (
    typeof clock === 'object' &&
    clock !== null &&
    Number.isInteger(clock.minute) &&
    Number.isInteger(clock.money) &&
    Number.isInteger(clock.paidMonths) &&
    typeof clock.bankrupt === 'boolean' &&
    Number.isInteger(v.reputation)
  );
};

// 保存されたバージョンから現在のバージョンまで順に移行する
export const migrate = (saveVersion: number, data: unknown): SaveData => {
  if (!Number.isInteger(saveVersion) || saveVersion < 1) throw new Error('セーブデータのバージョンが不正');
  if (saveVersion > SAVE_VERSION) throw new Error('このバージョンより新しいセーブデータは読み込めない');
  let current = data;
  for (let v = saveVersion; v < SAVE_VERSION; v++) {
    const step = migrations[v];
    if (!step) throw new Error(`バージョン ${v} からの移行が定義されていない`);
    current = step(current);
  }
  if (!isSaveData(current)) throw new Error('セーブデータの形式が不正');
  return current;
};
