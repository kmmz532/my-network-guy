// マップの拡大・縮小と移動の計算（純粋関数）。描画と操作は Scene.ts が行い、ここでは位置と倍率だけを求める。
// 拡大率は整数倍（1〜4倍）だけにする。小数倍だとドット絵がにじむため。
// 位置（x・y）は画面の座標（px）で、マップの左上の点が画面のどこにあるかを表す。整数に丸める。

export const ZOOM_LEVELS = [1, 2, 3, 4] as const;
export type Zoom = (typeof ZOOM_LEVELS)[number];

export interface Size {
  w: number;
  h: number;
}

export interface Camera {
  zoom: Zoom;
  // マップの左上の点の画面上の位置（px）
  x: number;
  y: number;
  // 「全体」の状態か。画面の大きさが変わったとき、全体に合わせ直す
  fit: boolean;
}

// 段階の番号（0始まり）を、範囲の中に収めて拡大率にする
const zoomAtIndex = (i: number): Zoom => ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, i))];

// 画面に収まる最大の整数倍（1〜4倍の範囲）。収まらなければ 1 倍
export const fitZoom = (map: Size, view: Size): Zoom => {
  const k = Math.floor(Math.min(view.w / map.w, view.h / map.h));
  return zoomAtIndex((Number.isFinite(k) ? k : 1) - 1);
};

// 拡大（dir = 1）か縮小（dir = -1）の段階へ進める。端では変わらない
export const stepZoom = (zoom: Zoom, dir: 1 | -1): Zoom => zoomAtIndex(ZOOM_LEVELS.indexOf(zoom) + dir);

// 軸ごとの位置の範囲。マップの端より外へは、画面の半分まで動かせる。
// 左端は画面の中央より右へ行かず、右端は画面の中央より左へ行かない
const axisRange = (mapPx: number, viewPx: number): [number, number] => [
  Math.ceil(viewPx / 2 - mapPx),
  Math.floor(viewPx / 2),
];

const clampAxis = (pos: number, mapPx: number, viewPx: number): number => {
  const [lo, hi] = axisRange(mapPx, viewPx);
  return Math.min(hi, Math.max(lo, Math.round(pos)));
};

// 位置を移動の範囲に収める（倍率は変えない）
export const clampCamera = (cam: Camera, map: Size, view: Size): Camera => ({
  ...cam,
  x: clampAxis(cam.x, map.w * cam.zoom, view.w),
  y: clampAxis(cam.y, map.h * cam.zoom, view.h),
});

// 全体に合わせる。画面に収まる倍率で、中央に置く
export const fitCamera = (map: Size, view: Size): Camera => {
  const zoom = fitZoom(map, view);
  return {
    zoom,
    x: Math.round((view.w - map.w * zoom) / 2),
    y: Math.round((view.h - map.h * zoom) / 2),
    fit: true,
  };
};

// 倍率を変える。anchor（画面の座標）の下にあったマップの点は、拡大・縮小の後も同じ位置に残す（カーソルの位置を中心に拡大する）
export const zoomCamera = (cam: Camera, map: Size, view: Size, zoom: Zoom, anchor: { x: number; y: number }): Camera => {
  if (zoom === cam.zoom) return cam;
  const mapX = (anchor.x - cam.x) / cam.zoom;
  const mapY = (anchor.y - cam.y) / cam.zoom;
  return clampCamera(
    { zoom, x: anchor.x - mapX * zoom, y: anchor.y - mapY * zoom, fit: false },
    map,
    view,
  );
};

// 画面上で (dx, dy) だけ動かす（マップの移動）。範囲の外へは動かない
export const panCamera = (cam: Camera, map: Size, view: Size, dx: number, dy: number): Camera =>
  clampCamera({ ...cam, x: cam.x + dx, y: cam.y + dy, fit: false }, map, view);

// 画面の大きさが変わったとき。「全体」なら全体に合わせ直す。そのほかは倍率を保ち、画面の中央の位置を保ったまま範囲に収める
export const resizeCamera = (cam: Camera, map: Size, oldView: Size, newView: Size): Camera => {
  if (cam.fit) return fitCamera(map, newView);
  return clampCamera(
    {
      ...cam,
      x: cam.x + (newView.w - oldView.w) / 2,
      y: cam.y + (newView.h - oldView.h) / 2,
    },
    map,
    newView,
  );
};
