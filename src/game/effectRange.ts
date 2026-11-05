// 家具の効果の範囲（チェビシェフ距離）のマス。マップの外のマスは含めない
export const rangeTiles = (
  cx: number,
  cy: number,
  range: number,
  width: number,
  height: number,
): { tx: number; ty: number }[] => {
  const tiles: { tx: number; ty: number }[] = [];
  for (let ty = cy - range; ty <= cy + range; ty++) {
    for (let tx = cx - range; tx <= cx + range; tx++) {
      if (tx >= 0 && ty >= 0 && tx < width && ty < height) tiles.push({ tx, ty });
    }
  }
  return tiles;
};
