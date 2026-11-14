// 機器のターミナルの、命令の木で解釈できない行の扱いと、略記・補完。
// 確認の命令（help・show・ping・traceroute）は src/network/command/ の木にある（解釈は command/run.ts の runLine）。
// 文言は tr（言語ファイルの引き当て）で作る。モードは持たない。
export type Tr = (key: string, params?: Record<string, string | number>) => string;

export interface TerminalLine {
  text: string;
  // err は失敗の行（画面で色を変える）
  kind: 'out' | 'err';
}

// 木で解釈できず、設定の命令でもない行。語を展開して、知らない命令の誤りを返す
export const runTerminal = (line: string, tr: Tr): TerminalLine[] => {
  const err = (text: string): TerminalLine => ({ text, kind: 'err' });
  const expanded = expandAbbrev(line);
  if (!expanded.ok) return [err(tr('ui.terminal.ambiguous'))];
  const words = expanded.line.split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return [];
  const [cmd] = words;
  return [err(tr('ui.terminal.unknown', { cmd: cmd === 'show' ? line.trim() : cmd }))];
};

// 入力の補完の候補。先頭の語・show の下位・ip の下位の順に、今の入力の続きを探す
const WORDS: Record<string, string[]> = {
  '': ['help', 'show', 'ping', 'traceroute', 'ip', 'no', 'hostname', 'clear'],
  show: ['ip', 'interfaces', 'running-config', 'mac'],
  'show mac': ['address-table'],
  'show ip': ['route', 'ospf', 'nat'],
  'show ip nat': ['translations'],
  'show ip rip': ['database'],
  'show ip ospf': ['neighbor'],
  ip: ['address', 'default-gateway', 'route'],
  no: ['ip', 'hostname'],
  'no ip': ['default-gateway', 'route'],
};

// 略記を正式な語に直す（Cisco と同じく、語が一意に決まるときだけ）。その語のあとに続く語も、同じ表で直す。
// 一意に決まらない略記があれば ambiguous を返し、何も展開しない。表にない語は、そのまま残す
export type Expanded = { ok: true; line: string } | { ok: false; reason: 'ambiguous' };
export const expandAbbrev = (line: string): Expanded => {
  const words = line.trim().split(/\s+/).filter((w) => w !== '');
  const out: string[] = [];
  let context = '';
  for (const word of words) {
    const candidates = (WORDS[context] ?? []).filter((w) => w.startsWith(word));
    if (candidates.includes(word)) {
      out.push(word);
      context = context === '' ? word : `${context} ${word}`;
    } else if (candidates.length === 1) {
      out.push(candidates[0]);
      context = context === '' ? candidates[0] : `${context} ${candidates[0]}`;
    } else if (candidates.length > 1) {
      return { ok: false, reason: 'ambiguous' };
    } else {
      // 表にない語（機器の名前・アドレスなど）は、そのまま残す。以降は表で直さない
      out.push(word);
      context = '\u0000';
    }
  }
  return { ok: true, line: out.join(' ') };
};

// 入力の行を補完する。候補が1つなら続きを書き足して末尾に空白を付け、複数なら共通の続きまで書き足す。候補がなければ変えない
export const completeLine = (line: string): string => {
  const trimmedStart = line.replace(/^\s+/, '');
  const endsWithSpace = /\s$/.test(trimmedStart);
  const words = trimmedStart.trim().split(/\s+/).filter((w) => w !== '');
  const typed = endsWithSpace || words.length === 0 ? '' : words[words.length - 1];
  const context = (endsWithSpace || words.length === 0 ? words : words.slice(0, -1)).join(' ');
  const candidates = (WORDS[context] ?? []).filter((w) => w.startsWith(typed));
  if (candidates.length === 0) return line;
  const common = candidates.reduce((a, b) => {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return a.slice(0, i);
  });
  if (candidates.length === 1) {
    const base = endsWithSpace || words.length === 0 ? trimmedStart : trimmedStart.slice(0, trimmedStart.length - typed.length);
    return `${base}${candidates[0]} `;
  }
  if (common.length > typed.length) return `${trimmedStart.slice(0, trimmedStart.length - typed.length)}${common}`;
  return line;
};
