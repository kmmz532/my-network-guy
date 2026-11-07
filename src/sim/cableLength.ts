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

// 2台の機器の位置をつなぐケーブルの長さ（マス）。経路は L字（cablePath）のため、長さはマンハッタン距離と一致する（N118）
// 長さと経路はこの関数だけから作る。経路の引き方を変えるときは、ここを直す
export const cableLengthOf = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
