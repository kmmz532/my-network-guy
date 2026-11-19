// シーケンス図の配置の計算（純粋関数）。縦の線は、制御の列に出てくる機器を出てくる順に並べる。
// 1つの行は1つの ControlStep で、矢印の根元（from）と先（ブロードキャストは届いた各機器）を、線の番号で持つ。
import type { ControlStep } from '../network/public';

export interface SequenceRow {
  step: ControlStep;
  // 矢印の根元の線の番号
  from: number;
  // 矢印の先の線の番号（ブロードキャストは届いた機器ごと）
  targets: number[];
  // 点線にするか（ICMP・TCP・HTTP 以外の制御）
  dashed: boolean;
}

export interface SequenceLayout {
  lanes: string[];
  rows: SequenceRow[];
}

const SOLID: readonly ControlStep['proto'][] = ['icmp', 'tcp', 'http'];

export function sequenceLayout(steps: readonly ControlStep[]): SequenceLayout {
  const lanes: string[] = [];
  const lane = (uid: string): number => {
    const i = lanes.indexOf(uid);
    if (i >= 0) return i;
    lanes.push(uid);
    return lanes.length - 1;
  };
  const rows = steps.map((step): SequenceRow => {
    const from = lane(step.from);
    const targets = step.to === '*' ? step.reached.map(lane) : [lane(step.to)];
    return { step, from, targets, dashed: !SOLID.includes(step.proto) };
  });
  return { lanes, rows };
}
