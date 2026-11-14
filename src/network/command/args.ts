// 命令の引数の読み取りに使う共通の関数。
import type { NetNode } from '../types';

// 口の番号から、機器のインターフェースの id を引く。その番号の口がなければ null
export const ifaceIdOf = (node: NetNode, port: number): string | null => node.interfaces.find((i) => i.port === port)?.id ?? null;
