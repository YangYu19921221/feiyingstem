/**
 * 句子背诵的判分与出题工具(2026-10-11)。纯函数,不碰 DOM,便于单测。
 *
 * 判分口径「宽容但不放水」(生产 288 句实测要处理的情况都在这里):
 * - 大小写、首尾空格、句末标点、句中逗号不算错
 * - 弯撇号 ’ 与直撇号 ' 一样(8 句带弯撇号,孩子键盘打不出来)
 * - 对话行前的破折号 —/–/- 不用写(86 句以破折号开头)
 * - 常见缩写与展开等价: What's = What is、don't = do not …
 * - 只标出真正写错/漏写的词,不整句判错
 */

const DASH_RE = /^\s*[—–-]+\s*/;

/** 显示与比对共用: 去掉对话破折号 */
export function stripDialogueDash(s: string): string {
  return s.replace(DASH_RE, '');
}

// 只展开不会有歧义的缩写。's 有「is / has / 所有格」三义,只对代词和疑问词展开
const CONTRACTIONS: Record<string, string[]> = {
  "i'm": ['i', 'am'], "you're": ['you', 'are'], "we're": ['we', 'are'], "they're": ['they', 'are'],
  "it's": ['it', 'is'], "he's": ['he', 'is'], "she's": ['she', 'is'], "that's": ['that', 'is'],
  "what's": ['what', 'is'], "where's": ['where', 'is'], "who's": ['who', 'is'], "how's": ['how', 'is'],
  "there's": ['there', 'is'], "here's": ['here', 'is'],
  "don't": ['do', 'not'], "doesn't": ['does', 'not'], "didn't": ['did', 'not'],
  "isn't": ['is', 'not'], "aren't": ['are', 'not'], "wasn't": ['was', 'not'], "weren't": ['were', 'not'],
  "can't": ['can', 'not'], "couldn't": ['could', 'not'], "won't": ['will', 'not'],
  "i'll": ['i', 'will'], "you'll": ['you', 'will'], "we'll": ['we', 'will'], "it'll": ['it', 'will'],
  "i've": ['i', 'have'], "we've": ['we', 'have'], "they've": ['they', 'have'],
  "let's": ['let', 'us'],
};

/** 切成用来比对的词(小写、去标点、统一撇号),保留原顺序 */
export function compareTokens(s: string): string[] {
  const words = stripDialogueDash(s)
    .normalize('NFC')
    .replace(/[‘’ʼ`´]/g, "'")
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .map(w => w.replace(/^'+|'+$/g, ''))
    .filter(Boolean);
  const out: string[] = [];
  for (const w of words) out.push(...(CONTRACTIONS[w] ?? [w]));
  return out;
}

export interface WordDiff {
  /** 原句(去破折号)里的每个词,用于展示 */
  text: string;
  /** 这个词有没有写对 */
  ok: boolean;
}

/**
 * 默写比对。返回 isCorrect + 原句逐词标注(哪个词写错/漏写)。
 * 用最长公共子序列对齐,所以多写、漏写、写错都只影响那几个词,不会整句往后错位。
 */
export function checkSentence(input: string, target: string): { isCorrect: boolean; words: WordDiff[] } {
  const a = compareTokens(input);
  const b = compareTokens(target);
  const isCorrect = a.length === b.length && a.every((w, i) => w === b[i]);

  // 展示按原句的词走(含原大小写与标点),每个展示词对应一到多个比对词(What's → what is)
  const display = stripDialogueDash(target).split(/\s+/).filter(Boolean);
  const perDisplay = display.map(d => compareTokens(d));

  // LCS 对齐
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const matched = new Array(m).fill(false);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { matched[j] = true; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }

  let k = 0;
  const words = display.map((text, idx) => {
    const cnt = perDisplay[idx].length;
    const ok = cnt === 0 || matched.slice(k, k + cnt).every(Boolean);
    k += cnt;
    return { text, ok: isCorrect || ok };
  });
  return { isCorrect, words };
}

/** 连词成句用的词块: 按空格切,标点跟着前面的词(孩子排的是词不是标点) */
export function arrangeChunks(english: string): string[] {
  return stripDialogueDash(english).split(/\s+/).filter(Boolean);
}

/** 打乱,但保证和原顺序不同(只有 1 块时原样返回) */
export function shuffleChunks<T>(items: T[], rand: () => number = Math.random): T[] {
  if (items.length < 2) return [...items];
  for (let attempt = 0; attempt < 8; attempt++) {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    if (out.some((x, i) => x !== items[i])) return out;
  }
  return [...items.slice(1), items[0]];
}

/** 连词成句判对: 拼回去的句子和原句按比对口径一致即可(相同的词块互换位置不算错) */
export function arrangeIsCorrect(picked: string[], english: string): boolean {
  const a = compareTokens(picked.join(' '));
  const b = compareTokens(english);
  return a.length === b.length && a.every((w, i) => w === b[i]);
}

/** 关键词挖空后的句子(展示用) + 正确答案。挖不出返回 null */
export function makeCloze(english: string, keyWord: string | null): { before: string; after: string; answer: string } | null {
  if (!keyWord) return null;
  const s = stripDialogueDash(english);
  const re = new RegExp(`\\b${keyWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  const m = re.exec(s);
  if (!m) return null;
  return { before: s.slice(0, m.index), after: s.slice(m.index + keyWord.length), answer: keyWord };
}

export function clozeIsCorrect(input: string, answer: string): boolean {
  return compareTokens(input).join(' ') === compareTokens(answer).join(' ');
}

/** 开口背最短要说多久(毫秒): 按词数估,一词约 280ms,至少 600ms。只判「真的开口了」,不判对错 */
export function minSpeechMs(english: string): number {
  return Math.max(600, compareTokens(english).length * 280);
}
