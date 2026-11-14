// 会社（セーブの内容）の型。保存する項目は COMPANY_KEYS に並べ、状態から会社を取り出すのは companyOf だけで行う。
import type { Effects, Office, Project } from '../sim/project';
import type { LedgerMonth } from '../sim/ledger';
import type { Familiarity } from '../sim/familiar';
import type { Staff } from '../data/schema';

// 遊び方。career は案件の経営ゲーム、sandbox は自由に設計する練習場（別の枠に保存する）
export type GameMode = 'career' | 'sandbox';

export interface Company {
  // 遊び方（移行前のセーブデータは career）
  mode: GameMode;
  // 社名（セーブの名前。経営の会社は必ず持つ・N133）
  name: string;
  clock: { minute: number; money: number; paidMonths: number; bankrupt: boolean; ledger: LedgerMonth[] | null };
  companyExp: number;
  // 評判（★の数の積み上げ。解放の条件には使わない。N55）
  reputation: number;
  // 経験値の1日分（納品以外の源の上限に使う。N55）
  expDay: number;
  expToday: number;
  // 在庫の機材（機材ID → 個数）
  owned: Record<string, number>;
  // 完了した固定案件のID
  completed: string[];
  // 納品した案件の数（N66）
  deliveries: number;
  // なじみの依頼の回数と型紙（N70）
  familiarity: Familiarity;
  // 依頼一覧（案件の内容を含む）
  offers: unknown[];
  nextOfferMinute: number;
  offerSeq: number;
  // 新しく解放した種類の届いた件数（N51b）
  newArrivals: Record<string, number>;
  // 乱数の状態
  rng: number;
  // 受注中の案件（なければ null）
  active: Project[];
  // いま設計・表示している案件のID
  focus: string | null;
  // 自社オフィスのネットワークと、自社案件で得た効果
  office: Office;
  effects: Effects;
  // 雇用中の社員と、社員の uid の連番
  staff: Staff[];
  staffSeq: number;
  // 採用の候補
  candidates: Staff[];
  // 初めての概念の案内を終えた（または飛ばした）固定案件のID
  guidesDone: string[];
  // サンドボックスで開いている教材（なければ null）
  sandboxLesson: SandboxLesson | null;
  // 初めて出した用語（用語集の ID）。出したものは2回目から出さない
  termsShown: string[];
}

export interface SandboxLesson {
  id: string;
  step: number;
  done: boolean;
}

// 保存する項目（Company のすべてのキー。Company の宣言の順）
export const COMPANY_KEYS = [
  'mode', 'name', 'clock', 'companyExp', 'reputation', 'expDay', 'expToday', 'owned', 'completed', 'deliveries',
  'familiarity', 'offers', 'nextOfferMinute', 'offerSeq', 'newArrivals', 'rng', 'active', 'focus', 'office', 'effects',
  'staff', 'staffSeq', 'candidates', 'guidesDone', 'sandboxLesson', 'termsShown',
] as const satisfies readonly (keyof Company)[];
type Missing = Exclude<keyof Company, (typeof COMPANY_KEYS)[number]>;
export const noMissing: [Missing] extends [never] ? true : never = true; // キーの書き漏れを型で落とす
// 状態から会社を取り出す（保存する項目だけを写す）
export const companyOf = (s: Company): Company => Object.fromEntries(COMPANY_KEYS.map((k) => [k, s[k]])) as unknown as Company;
