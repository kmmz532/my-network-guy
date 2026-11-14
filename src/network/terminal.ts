// 機器のターミナルの出力の型。命令の解釈・実行・補完は src/network/command/ の木にある。
// 文言は tr（言語ファイルの引き当て）で作る。
export type Tr = (key: string, params?: Record<string, string | number>) => string;

export interface TerminalLine {
  text: string;
  // err は失敗の行（画面で色を変える）
  kind: 'out' | 'err';
}
