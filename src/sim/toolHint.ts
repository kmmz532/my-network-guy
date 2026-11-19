// 道具と合わない操作をしたときに、合う道具を教える一言（初めての会社の間だけ、種類ごとに1回）。出すかの判定だけを持つ純粋関数
import type { Tool } from '../stores/useGameStore';

// 出来事。portList は配線の道具で機器を押してポートの一覧が出た、dragMove は選択の道具で機器をドラッグして動かした、removed は撤去の道具で機器を片付けた
export type ToolEvent = 'portList' | 'dragMove' | 'removed';

// 一言の種類（端末に覚える値）
export type ToolHintKind = 'select' | 'wire' | 'undo';
export const TOOL_HINT_KINDS: readonly ToolHintKind[] = ['select', 'wire', 'undo'];

// 種類ごとの、起きた出来事の道具・光らせるボタン（data-guide の名前）・文言
export const TOOL_HINTS: Record<ToolHintKind, { event: ToolEvent; tool: Tool; target: string; key: string }> = {
  select: { event: 'portList', tool: 'wire', target: 'tool.select', key: 'toolHint.select' },
  wire: { event: 'dragMove', tool: 'select', target: 'tool.wire', key: 'toolHint.wire' },
  undo: { event: 'removed', tool: 'remove', target: 'undo', key: 'toolHint.undo' },
};

// 出せる会社か。offers は依頼が届く遊び方（MODE_TRAITS）、companiesStarted はこの端末で新しく始めた会社の数（2社目以降は出さない）、guideOn は案内の設定、guideShowing は案件などの案内の手順を出している間
export interface ToolHintGate {
  offers: boolean;
  companiesStarted: number;
  guideOn: boolean;
  guideShowing: boolean;
}

// 出来事に対して出す一言の種類。出さないときは null。shown は、すでに出した種類
export const toolHintOf = (event: ToolEvent, tool: Tool, shown: readonly ToolHintKind[], gate: ToolHintGate): ToolHintKind | null => {
  if (!gate.offers || gate.companiesStarted > 1 || !gate.guideOn || gate.guideShowing) return null;
  const kind = TOOL_HINT_KINDS.find((k) => TOOL_HINTS[k].event === event && TOOL_HINTS[k].tool === tool);
  if (kind === undefined || shown.includes(kind)) return null;
  return kind;
};
