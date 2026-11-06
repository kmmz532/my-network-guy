// マップ（Scene）の画面の判定を、マップの外（インベントリの欄など）から使うための登録口。
// Scene が作られたときに登録し、破棄されたときに外す。マップがなければ null のまま。

export interface MapView {
  // 画面の座標（クライアントの座標）のマス。マップの外なら null
  tileAtClient: (clientX: number, clientY: number) => { tx: number; ty: number } | null;
  // 品目（機材・家具）を、そのマスに置けるか
  canPlace: (id: string, tx: number, ty: number) => boolean;
}

let current: MapView | null = null;

export const setMapView = (view: MapView | null): void => {
  current = view;
};

export const mapViewOf = (): MapView | null => current;
