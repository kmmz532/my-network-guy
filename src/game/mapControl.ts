// マップの拡大・縮小と移動の命令の窓口。キー操作（keymap.ts）とマップの上のボタンが呼び、描画の担当（Scene.ts）が中身を結びつける。
// 結びつけられていないときは何もしない。

export interface MapCommands {
  // 拡大・縮小（画面の中央を中心に、1段階）
  zoomIn: () => void;
  zoomOut: () => void;
  // 全体に合わせる
  fit: () => void;
  // 画面上で動かす（dx・dy は px）
  pan: (dx: number, dy: number) => void;
}

let bound: MapCommands | null = null;

// 描画の担当が呼ぶ。破棄するときは null を渡す
export const bindMapCommands = (commands: MapCommands | null): void => {
  bound = commands;
};

// 矢印キー1回で動かす量（px）
export const PAN_KEY_PX = 80;

export const mapCommands: MapCommands = {
  zoomIn: () => bound?.zoomIn(),
  zoomOut: () => bound?.zoomOut(),
  fit: () => bound?.fit(),
  pan: (dx, dy) => bound?.pan(dx, dy),
};
