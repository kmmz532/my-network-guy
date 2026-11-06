// ローマ字の入力をひらがなに直す（検索用。外部のライブラリは使わない）。
// ヘボン式と訓令式の両方を受け付ける（shi/si、tsu/tu、chi/ti、fu/hu、ji/zi など）。促音（tta）、撥音（n・nn・n'）、拗音（kya）、長音（-）を扱う。
// 入力の最後に残った子音（例: suit の t）は確定していないものとして、その子音で始まる仮名の続きを候補にする。

const TABLE: [string, string][] = [
  ['a', 'あ'], ['i', 'い'], ['u', 'う'], ['e', 'え'], ['o', 'お'],
  ['ka', 'か'], ['ki', 'き'], ['ku', 'く'], ['ke', 'け'], ['ko', 'こ'],
  ['ga', 'が'], ['gi', 'ぎ'], ['gu', 'ぐ'], ['ge', 'げ'], ['go', 'ご'],
  ['sa', 'さ'], ['shi', 'し'], ['si', 'し'], ['su', 'す'], ['se', 'せ'], ['so', 'そ'],
  ['za', 'ざ'], ['ji', 'じ'], ['zi', 'じ'], ['zu', 'ず'], ['ze', 'ぜ'], ['zo', 'ぞ'],
  ['ta', 'た'], ['chi', 'ち'], ['ti', 'ち'], ['tsu', 'つ'], ['tu', 'つ'], ['te', 'て'], ['to', 'と'],
  ['da', 'だ'], ['di', 'ぢ'], ['du', 'づ'], ['de', 'で'], ['do', 'ど'],
  ['na', 'な'], ['ni', 'に'], ['nu', 'ぬ'], ['ne', 'ね'], ['no', 'の'],
  ['ha', 'は'], ['hi', 'ひ'], ['fu', 'ふ'], ['hu', 'ふ'], ['he', 'へ'], ['ho', 'ほ'],
  ['ba', 'ば'], ['bi', 'び'], ['bu', 'ぶ'], ['be', 'べ'], ['bo', 'ぼ'],
  ['pa', 'ぱ'], ['pi', 'ぴ'], ['pu', 'ぷ'], ['pe', 'ぺ'], ['po', 'ぽ'],
  ['ma', 'ま'], ['mi', 'み'], ['mu', 'む'], ['me', 'め'], ['mo', 'も'],
  ['ya', 'や'], ['yu', 'ゆ'], ['yo', 'よ'],
  ['ra', 'ら'], ['ri', 'り'], ['ru', 'る'], ['re', 'れ'], ['ro', 'ろ'],
  ['wa', 'わ'], ['wo', 'を'],
  ['kya', 'きゃ'], ['kyu', 'きゅ'], ['kyo', 'きょ'],
  ['gya', 'ぎゃ'], ['gyu', 'ぎゅ'], ['gyo', 'ぎょ'],
  ['sha', 'しゃ'], ['shu', 'しゅ'], ['sho', 'しょ'], ['sya', 'しゃ'], ['syu', 'しゅ'], ['syo', 'しょ'],
  ['ja', 'じゃ'], ['ju', 'じゅ'], ['jo', 'じょ'], ['zya', 'じゃ'], ['zyu', 'じゅ'], ['zyo', 'じょ'],
  ['cha', 'ちゃ'], ['chu', 'ちゅ'], ['cho', 'ちょ'], ['tya', 'ちゃ'], ['tyu', 'ちゅ'], ['tyo', 'ちょ'],
  ['nya', 'にゃ'], ['nyu', 'にゅ'], ['nyo', 'にょ'],
  ['hya', 'ひゃ'], ['hyu', 'ひゅ'], ['hyo', 'ひょ'],
  ['bya', 'びゃ'], ['byu', 'びゅ'], ['byo', 'びょ'],
  ['pya', 'ぴゃ'], ['pyu', 'ぴゅ'], ['pyo', 'ぴょ'],
  ['mya', 'みゃ'], ['myu', 'みゅ'], ['myo', 'みょ'],
  ['rya', 'りゃ'], ['ryu', 'りゅ'], ['ryo', 'りょ'],
];

// 長い綴りから先に当てる（sha を s + ha にしない）
const SORTED = [...TABLE].sort((a, b) => b[0].length - a[0].length);
const VOWEL = /[aiueo]/;

export interface RomajiResult {
  // 確定したひらがな
  kana: string;
  // 確定しなかった子音（入力の最後）
  pending: string;
}

// ローマ字をひらがなに直す。確定できない最後の子音は pending に残す
export const romajiToKana = (input: string): RomajiResult => {
  const s = input.toLowerCase();
  let kana = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const next = s[i + 1];
    // 撥音: nn、n'、n の後に子音（na・ni などの母音・y 以外）
    if (c === 'n') {
      // nn は、次が母音・y なら1つ目だけを撥音にし、2つ目は次の音の頭にする（konnichi = こんにち）
      if (next === 'n') {
        kana += 'ん';
        i += VOWEL.test(s[i + 2] ?? '') || s[i + 2] === 'y' ? 1 : 2;
        continue;
      }
      if (next === "'") {
        kana += 'ん';
        i += 2;
        continue;
      }
      // 語末の n は撥音として確定する（しん・しんぶん）
      if (next === undefined) {
        kana += 'ん';
        i += 1;
        continue;
      }
      if (!VOWEL.test(next) && next !== 'y') {
        kana += 'ん';
        i += 1;
        continue;
      }
    }
    // 促音: 同じ子音が続く（tta・kka。nn は上で撥音になる）
    if (next !== undefined && c === next && !VOWEL.test(c) && c !== 'n') {
      kana += 'っ';
      i += 1;
      continue;
    }
    if (c === '-') {
      kana += 'ー';
      i += 1;
      continue;
    }
    const hit = SORTED.find(([romaji]) => s.startsWith(romaji, i));
    if (hit) {
      kana += hit[1];
      i += hit[0].length;
      continue;
    }
    // 英字以外（空白・記号）はそのまま残す。英字で表せない残りは、確定しない子音として返す
    if (!/[a-z]/.test(c)) {
      kana += c;
      i += 1;
      continue;
    }
    return { kana, pending: s.slice(i) };
  }
  return { kana, pending: '' };
};

// 検索の候補（ひらがな）。確定した読みと、確定しなかった子音の続きの仮名（その子音で始まる仮名）
export const romajiCandidates = (input: string): string[] => {
  const { kana, pending } = romajiToKana(input);
  if (pending === '') return [kana];
  const continuations = TABLE.filter(([romaji]) => romaji.startsWith(pending)).map(([, k]) => k);
  return [...new Set(continuations.map((k) => kana + k))];
};
