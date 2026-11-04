// 最初の案件（c001）で、操作の手順を案内する。手順の完了は状態から判定する。
import type { Project } from './project';
import type { Trace } from '../stores/useGameStore';

export type GuideStep = 'accept' | 'ip' | 'wire' | 'probe' | 'build';

export interface GuideItem {
  step: GuideStep;
  done: boolean;
}

export const firstContractGuide = (active: Project | null, trace: Trace | null, completed: readonly string[]): GuideItem[] => {
  // 最初の案件を完了した後は、案内をすべて済んだものとして扱う
  const finished = completed.includes('c001_direct_link');
  const ipSet = (uid: string) => (active?.nodes.find((n) => n.uid === uid)?.interfaces.length ?? 0) > 0;
  return [
    { step: 'accept', done: finished || active !== null },
    { step: 'ip', done: finished || (ipSet('pc_a') && ipSet('pc_b')) },
    { step: 'wire', done: finished || (active?.links.length ?? 0) > 0 },
    { step: 'probe', done: finished || trace?.result.ok === true },
    { step: 'build', done: finished || active?.phase === 'build' },
  ];
};

// まだ終わっていない最初の手順（すべて終わっていれば null）
export const currentGuideStep = (items: GuideItem[]): GuideStep | null => items.find((i) => !i.done)?.step ?? null;
