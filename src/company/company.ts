// 会社（セーブの内容）の型。保存する項目は COMPANY_KEYS に並べ、状態から会社を取り出すのは companyOf だけで行う。
import type { Effects, Office, Project } from '../sim/project';
import type { LedgerMonth } from '../sim/ledger';
import type { Familiarity } from '../sim/familiar';
import type { Staff } from '../data/schema';

// 遊び方。career は案件の経営ゲーム、sandbox は自由に設計する練習場（別の枠に保存する）
export type GameMode = 'career' | 'sandbox';

// 遊び方ごとの能力。offers は依頼が届き、受注して遊ぶか（サンドボックスは依頼がない）。allTopics はレベルによらず論点をすべて解放するか（サンドボックスは全部）。anyFloor は機器を床の上にも置けるか（サンドボックスは置ける）
export const MODE_TRAITS: Record<GameMode, { offers: boolean; allTopics: boolean; anyFloor: boolean }> = {
  career: { offers: true, allTopics: false, anyFloor: false },
  sandbox: { offers: false, allTopics: true, anyFloor: true },
};

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
  // 合格させたことのある達成条件の型（型ごとに初めての納品で経験値を得る）
  firstGoals: string[];
  // 自社の実績（月末に、自社オフィスの構成が満たしている論点）
  achievements: string[];
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
  // 案内をしまった案件のID（教材は lesson:<教材のID>）。しまった案内は、戻すまで吹き出しを出さない
  guidesHidden: string[];
  // 移行が無線の端末のつながりを外したこと（読み込みで1回だけ知らせる。保存しない）
  homeRouterWirelessOff?: boolean;
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
  'mode', 'name', 'clock', 'companyExp', 'reputation', 'expDay', 'expToday', 'owned', 'completed', 'deliveries', 'firstGoals', 'achievements',
  'familiarity', 'offers', 'nextOfferMinute', 'offerSeq', 'newArrivals', 'rng', 'active', 'focus', 'office', 'effects',
  'staff', 'staffSeq', 'candidates', 'guidesDone', 'guidesHidden', 'sandboxLesson', 'termsShown',
] as const satisfies readonly (keyof Company)[];
// 読み込みの知らせだけに使い、保存しない項目（homeRouterWirelessOff）は除く
type Missing = Exclude<keyof Company, (typeof COMPANY_KEYS)[number] | 'homeRouterWirelessOff'>;
export const noMissing: [Missing] extends [never] ? true : never = true; // キーの書き漏れを型で落とす
// 状態から会社を取り出す（保存する項目だけを写す）
export const companyOf = (s: Company): Company => Object.fromEntries(COMPANY_KEYS.map((k) => [k, s[k]])) as unknown as Company;
