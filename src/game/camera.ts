// マップの拡大・縮小と移動の計算（純粋関数）。描画と操作は Scene.ts が行い、ここでは位置と倍率だけを求める。
// 拡大率は、マウス・キーでの拡大縮小では整数倍（1〜4倍）だけにする。
// 全体表示（fit）だけ小数倍を許す（0.5〜4倍、0.25 刻み）。ドット絵のテクスチャは nearest で描くため、にじまない。
// 位置（x・y）は画面の座標（px）で、マップの左上の点が画面のどこにあるかを表す。整数に丸める。

export const ZOOM_LEVELS = [1, 2, 3, 4] as const;
// 拡大率。段階の移動は ZOOM_LEVELS の整数倍、全体表示だけ小数倍を取る
export type Zoom = number;

// 全体表示の拡大率の範囲と刻み
const FIT_MIN = 0.5;
const FIT_MAX = 4;
const FIT_STEP = 0.25;
// 整数倍で収まる倍率が、収まる最大の値のこの割合以上なら、整数倍を使う（にじみを避ける）
const INTEGER_KEEP_RATIO = 0.85;

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

// 全体表示の拡大率。画面に収まる最大の倍率を求め、整数倍で収まるならそれを、収まらなければ 0.25 刻みに切り下げる（0.5〜4倍）。
// 整数倍は、収まる最大の値の 85% 以上のときだけ使う（例：1.9 倍が収まるなら 1 倍より 1.75 倍を選ぶ）
export const fitZoom = (map: Size, view: Size): Zoom => {
  const s = Math.min(view.w / map.w, view.h / map.h);
  if (!Number.isFinite(s)) return 1;
  if (s >= FIT_MAX) return FIT_MAX;
  const k = Math.floor(s);
  if (k >= 1 && k >= INTEGER_KEEP_RATIO * s) return k;
  return Math.min(FIT_MAX, Math.max(FIT_MIN, Math.floor(s / FIT_STEP) * FIT_STEP));
};

// 拡大（dir = 1）か縮小（dir = -1）の段階へ進める。端では変わらない。
// 全体表示の小数倍からは、拡大は次の整数倍、縮小は前の整数倍へ移る（1倍より小さいときは縮小しない）
export const stepZoom = (zoom: Zoom, dir: 1 | -1): Zoom => {
  const i = ZOOM_LEVELS.indexOf(zoom as (typeof ZOOM_LEVELS)[number]);
  if (i >= 0) return zoomAtIndex(i + dir);
  if (dir === 1) return ZOOM_LEVELS.find((level) => level > zoom) ?? ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
  const below = [...ZOOM_LEVELS].reverse().find((level) => level < zoom);
  return below ?? zoom;
};

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
