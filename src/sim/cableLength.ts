// ケーブルの長さ（N49）。地図の長さは「マス」で持ち、画面と説明はメートルで出す（1マスの長さは balance.json の metersPerTile）。
// 上限は cables.json の maxLengthTiles（マス）。長さが0（同じマス）と、上限を超えたときは理由を分ける。
export const metersOf = (tiles: number, metersPerTile: number): number => tiles * metersPerTile;

// 長さの判定。0マス以下は「届かない長さ」（cable）、上限を超えるときは「長すぎる」（cableTooLong）
export type CableLengthCheck = 'ok' | 'cable' | 'cableTooLong';

export const checkCableLength = (tiles: number, maxTiles: number): CableLengthCheck => {
  if (tiles < 1) return 'cable';
  if (tiles > maxTiles) return 'cableTooLong';
  return 'ok';
};
