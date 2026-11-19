// シーケンス図の窓の ref（タブの文字列）の組み立てと解釈。画面に依存しない純粋な関数（試験で確かめる）
// 書式: ping|from|to ・ http|from|to|port（名前で引いた通信は |name を続ける）・dhcp|client ・ ospf|a|b ・ stp ・ vrrp|group
import type { ControlTrigger } from '../network/public';

// 窓の ref に入れる、制御の指定
export const sequenceRefOf = (trigger: ControlTrigger): string => {
  switch (trigger.kind) {
    case 'ping':
      return `ping|${trigger.from}|${trigger.to}`;
    case 'http':
      return trigger.name === undefined
        ? `http|${trigger.from}|${trigger.to}|${trigger.port}`
        : `http|${trigger.from}|${trigger.to}|${trigger.port}|${trigger.name}`;
    case 'dhcp':
      return `dhcp|${trigger.client}`;
    case 'ospf':
      return `ospf|${trigger.a}|${trigger.b}`;
    case 'stp':
      return 'stp';
    case 'vrrp':
      return `vrrp|${trigger.group}`;
  }
};

// 窓の ref に入れる、通信の指定（名前で引いた通信は名前も入れる）
export const sequenceRef = (trace: { kind: 'ping' | 'http'; src: string; dst: string; name?: string }): string =>
  sequenceRefOf(
    trace.kind === 'http'
      ? { kind: 'http', from: trace.src, to: trace.dst, port: 80, ...(trace.name !== undefined ? { name: trace.name } : {}) }
      : { kind: 'ping', from: trace.src, to: trace.dst },
  );

// 窓の ref を制御の指定に戻す。書式が正しくなければ例外
export const parseRef = (ref: string): ControlTrigger => {
  const [kind, a, b, c, d] = ref.split('|');
  if (kind === 'ping') return { kind, from: a, to: b };
  if (kind === 'http') return { kind, from: a, to: b, port: Number(c), ...(d !== undefined && d !== '' ? { name: d } : {}) };
  if (kind === 'dhcp') return { kind, client: a };
  if (kind === 'ospf') return { kind, a, b };
  if (kind === 'stp') return { kind };
  if (kind === 'vrrp') return { kind, group: Number(a) };
  throw new Error(`シーケンス図: 通信の指定が不正 ${ref}`);
};
