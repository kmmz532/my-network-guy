// 命令の木の型。命令は CommandSpec 1つで表し、解釈（parse.ts）と実行（run.ts）はこの表だけを読む。
import type { ConfigChange } from '../../company/operation';
import type { NetworkState } from '../engine/state';
import type { MacEntry } from '../mac';
import type { Tr, TerminalLine } from '../terminal';
import type { EngineData, NetLink, NetNode } from '../types';
import type { Trace } from '../../sim/project';

export type Mode = 'exec' | 'config' | 'interface' | 'router-rip' | 'router-ospf' | 'router-bgp';
export type ArgKind = 'iface' | 'ip' | 'mask' | 'wildcard' | 'prefix' | 'vlan' | 'vlanList' | 'area' | 'asn' | 'number' | 'word' | 'hostOrIp';
export type Token =
  | { word: string }
  | { arg: ArgKind; name: string }
  | { rest: string }; // 残りの語をまとめて受け取る。語がなければ空文字

export interface TerminalSession {
  mode: Mode;
  iface: { kind: 'port'; port: number } | { kind: 'svi'; vlan: number } | null; // interface モードの対象
  process: number | null; // router ospf の番号・router bgp の AS 番号
}

export interface TerminalContext {
  node: NetNode;
  nodes: NetNode[];
  links: NetLink[];
  data: EngineData;
  // 問い合わせの結果（計算の本体）。機器の画面が store から渡す
  state: NetworkState;
  // 機器の画面に出す名前（省略時は uid）
  nameOf?: (node: NetNode) => string;
  // ARP の表（ping で覚えたもの。保存しない）（N69）
  arp?: { ip: string; mac: string }[];
  // L2スイッチの MAC の表（通信で覚えたもの。保存しない）（N69）
  macTable?: MacEntry[];
  // 通信が届いたときに呼ぶ（宛先の機器の uid）。画面が ARP と MAC の表を覚えるために使う（N69）
  onReach?: (dstUid: string) => void;
  // ping・traceroute の経路を画面上でパケットとして流す
  onTrace?: (trace: Trace) => void;
}

export interface CommandContext extends TerminalContext {
  session: TerminalSession;
  unlocked: (topic: string) => boolean;
  hideValues: boolean; // 教材・演習を開いている間は、予測と候補に引数の値を出さない
  readOnly: boolean; // 読み取り専用の機器。設定を変える命令は、構文の検査の後で読み取り専用の誤りを返す
}

export interface CommandResult {
  lines: readonly TerminalLine[];
  change: ConfigChange | null; // 世界へ渡す設定の操作（src/world/operation.ts）
  session: TerminalSession | null; // モードを変えるときだけ
}

export interface CommandSpec {
  id: string; // '<論点>.<名前>'。論点のない命令は 'core.<名前>'
  modes: readonly Mode[];
  tokens: readonly Token[];
  help: string; // 言語ファイルの鍵 'ui.cmd.<id>'。鍵を足すまでは空文字
  topic: string | null; // src/network/topics.ts の論点の ID
  writes: boolean; // 設定を変える命令は true（読み取り専用の機器では実行の前に拒否する）。解釈は生の語で行う
  run: (args: Readonly<Record<string, string>>, ctx: CommandContext, tr: Tr) => CommandResult;
}
