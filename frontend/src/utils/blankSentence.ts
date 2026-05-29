/**
 * 在例句中定位「目标词」并返回挖空的字符区间，用于句子填空。
 * 关键：容忍常见词形变化(第三人称单数 helps、复数 hands、过去式、现在分词、
 * 以及少量高频不规则 made/does 等),短语按「首词可变形 + 其余词原样」匹配。
 *
 * 找不到返回 null —— 调用方应跳过该词，绝不展示「没有横线」的句子。
 */

// 高频不规则词 → 归一到同一词干，保证目标词与句中变形两边一致
const IRREGULAR: Record<string, string> = {
  make: 'make', makes: 'make', made: 'make', making: 'make',
  do: 'do', does: 'do', did: 'do', done: 'do', doing: 'do',
  say: 'say', says: 'say', said: 'say',
  go: 'go', goes: 'go', went: 'go', gone: 'go', going: 'go',
  have: 'have', has: 'have', had: 'have', having: 'have',
  get: 'get', gets: 'get', got: 'get', gotten: 'get',
  take: 'take', takes: 'take', took: 'take', taken: 'take', taking: 'take',
  give: 'give', gives: 'give', gave: 'give', given: 'give',
  come: 'come', comes: 'come', came: 'come', coming: 'come',
  run: 'run', runs: 'run', ran: 'run', running: 'run',
  see: 'see', sees: 'see', saw: 'see', seen: 'see',
  eat: 'eat', eats: 'eat', ate: 'eat', eaten: 'eat',
  write: 'write', writes: 'write', wrote: 'write', written: 'write',
  sing: 'sing', sings: 'sing', sang: 'sing', sung: 'sing',
  buy: 'buy', buys: 'buy', bought: 'buy',
  find: 'find', finds: 'find', found: 'find',
  put: 'put', puts: 'put',
};

/** 小写并去掉首尾非字母字符（保留内部空格） */
const clean = (s: string): string => s.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '');

/** 把一个词归一成词干，吃掉常见屈折后缀 */
function stem(raw: string): string {
  const w = clean(raw);
  if (!w) return '';
  if (IRREGULAR[w]) return IRREGULAR[w];
  let s = w;
  if (s.length >= 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length >= 4 && s.endsWith('ies')) s = s.slice(0, -3) + 'y';
  else if (s.length >= 4 && s.endsWith('ied')) s = s.slice(0, -3) + 'y';
  else if (s.length >= 4 && s.endsWith('es')) s = s.slice(0, -2);
  else if (s.length >= 4 && s.endsWith('ed')) s = s.slice(0, -2);
  else if (s.length >= 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  if (s.endsWith('e')) s = s.slice(0, -1); // introduce/introduces 都归到 introduc
  return s;
}

interface Tok { text: string; start: number; end: number; }

function tokenize(s: string): Tok[] {
  const toks: Tok[] = [];
  const re = /[A-Za-z']+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    toks.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return toks;
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * 返回句子中应挖空的字符区间 {start, end}，找不到返回 null。
 */
export function findBlankRange(
  sentence: string,
  target: string,
): { start: number; end: number } | null {
  const tw = clean(target).split(/\s+/).filter(Boolean);
  const toks = tokenize(sentence);
  if (tw.length === 0 || toks.length === 0) return null;

  const tStems = tw.map(stem);

  // 滑窗匹配整个短语/单词：每个位置 stem 相等或原词相等即算命中
  for (let i = 0; i + tw.length <= toks.length; i++) {
    let ok = true;
    for (let k = 0; k < tw.length; k++) {
      const tok = toks[i + k];
      if (stem(tok.text) !== tStems[k] && clean(tok.text) !== tw[k]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      return { start: toks[i].start, end: toks[i + tw.length - 1].end };
    }
  }

  // 单词兜底：罕见变形时用「公共前缀 ≥3 且接近词长」选最接近的 token
  if (tw.length === 1) {
    const base = tw[0];
    let best: Tok | null = null;
    for (const t of toks) {
      const c = clean(t.text);
      const lcp = commonPrefix(c, base);
      if (lcp >= 3 && lcp >= base.length - 2) {
        if (!best || Math.abs(c.length - base.length) < Math.abs(clean(best.text).length - base.length)) {
          best = t;
        }
      }
    }
    if (best) return { start: best.start, end: best.end };
  }

  return null;
}

/** 该例句能否给目标词挖空（用于筛掉展示不了横线的词） */
export function canBlank(sentence: string | null | undefined, target: string): boolean {
  return !!sentence && findBlankRange(sentence, target) !== null;
}
