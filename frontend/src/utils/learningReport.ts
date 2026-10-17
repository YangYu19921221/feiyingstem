/**
 * 分类学习「学习报告」—— 给家长看的那张分享图的数据口径(唯一真源)
 *
 * 图由 components/classify/LearningReportDialog 在 canvas 上画,这里只决定「写什么」。
 *
 * 口径:
 * - 分数 = 听写第一次就拼对的比例,公式与 ClassifySummary 的 overallRate 相同(分类学习那边
 *   fillBlankResults 恒为空):孩子在结算页看到 85、家长在图上看到的也是 85。
 *   组小结页点开时算的是「这次已学的几组合计」,图上会写明学到第几组
 * - 「一次就拼对」「还要多练」按听写**首答**分,不写「已掌握」—— 当天拼对不等于记住了,
 *   对家长说「掌握」是夸大
 * - 建议全是规则生成、写给家长能照着做的动作(念中文让孩子默写),不承诺分数
 */
import type { DictationResult } from '../components/classify/DictationPhase';

export type ReportTier = 'excellent' | 'good' | 'keep';

/** 插画三档(public/report-card/{tier}.jpg)。门槛取结算页段位里 90 / 60 两条线,插画不再细分 */
export function tierOf(rate: number): ReportTier {
  if (rate >= 90) return 'excellent';
  if (rate >= 60) return 'good';
  return 'keep';
}

/** 档位文字。门槛与 ClassifySummary 的 RANK_TIERS 一致(100/90/80/60);
 *  措辞换成家长的说法(结算页的 PERFECT / 传说级 是给孩子的游戏化说法) */
export function rankTextOf(rate: number): string {
  if (rate >= 100) return '满分';
  if (rate >= 90) return '优秀';
  if (rate >= 80) return '很棒';
  if (rate >= 60) return '不错';
  return '继续加油';
}

export type SpellingIssue = 'case' | 'missing' | 'extra' | 'order' | 'vowel' | 'other';

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

function isSubsequence(short: string, long: string): boolean {
  if (!short) return true;
  let i = 0;
  for (const ch of long) {
    if (ch === short[i]) i += 1;
    if (i === short.length) return true;
  }
  return false;
}

/** 粗分一个拼错属于哪类。只认几种一眼能说清的,说不清的归 other(不给建议,别硬凑) */
export function spellingIssueOf(expected: string, wrote: string): SpellingIssue {
  const e = expected.trim();
  const w = wrote.trim();
  if (!w || !e) return 'other';
  const el = e.toLowerCase();
  const wl = w.toLowerCase();
  if (el === wl) return 'case';
  if (el.length === wl.length) {
    if ([...el].sort().join('') === [...wl].sort().join('')) return 'order';
    for (let i = 0; i < el.length; i += 1) {
      if (el[i] !== wl[i] && !(VOWELS.has(el[i]) && VOWELS.has(wl[i]))) return 'other';
    }
    return 'vowel';
  }
  if (wl.length < el.length && isSubsequence(wl, el)) return 'missing';
  if (wl.length > el.length && isSubsequence(el, wl)) return 'extra';
  return 'other';
}

const ISSUE_TIP: Record<Exclude<SpellingIssue, 'other'>, (n: number, eg: string) => string> = {
  missing: (n, eg) => `有 ${n} 个词漏了字母(${eg}):让孩子按音节一段一段念、一段一段写,写完再对着读一遍。`,
  extra: (n, eg) => `有 ${n} 个词多写了字母(${eg}):写之前先完整念一遍,数一数一共几个字母。`,
  order: (n, eg) => `有 ${n} 个词字母顺序写反了(${eg}):写完让孩子用手指着,一个字母一个字母核对。`,
  vowel: (n, eg) => `有 ${n} 个词元音字母写混了(${eg}):多听几遍读音,注意 a、e、i、o、u 在词里怎么读。`,
  case: (n, eg) => `有 ${n} 个词大小写写错了(${eg}):人名、地名、星期、月份首字母大写,其余一般小写。`,
};

export interface ReportWord {
  id: number;
  word: string;
  /** 精简后的中文意思(去词性、只留第一个义项),家长不认识英文时靠它 */
  meaning: string | null;
}

/** 「n. 苹果；苹果树」→「苹果」。词库释义格式不一,只做最保守的裁剪 */
export function shortMeaning(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let m = raw.replace(/\s+/g, ' ').trim();
  // 去掉开头的词性(n. / adj. / v.&n. / vt.)
  m = m.replace(/^(?:[a-z]{1,5}\.\s*(?:[&/,，]\s*)?)+/i, '').trim();
  // 第一个义项到分隔符或下一个词性为止(词库里有「v.微笑   n.微笑；笑容」这种多词性写法)
  m = m.split(/[；;，,、|]|\s+[a-z]{1,5}\./i)[0].trim();
  if (!m) return null;
  return m.length > 8 ? `${m.slice(0, 8)}…` : m;
}

export interface WeakWord extends ReportWord {
  /** 孩子第一次写成了什么(写的就是正确拼写或没记到时为 null) */
  wrote: string | null;
}

export interface ReportInput {
  /** 孩子的姓名;取不到就留空(别拿用户名顶,用户名常是手机号,发群里就泄露了) */
  childName: string;
  bookName?: string | null;
  unitName: string;
  /** 「学到第 2/4 组」这类说明;整单元一组学完时为空 */
  progressText?: string | null;
  /** 本次学的全部词(多组合并) */
  words: ReportWord[];
  /** 听写首答结果(与结算页同一份) */
  dictation: DictationResult[];
  /** 净活动秒数(已扣发呆/切屏) */
  elapsedSeconds: number;
  at?: Date;
}

export interface LearningReport {
  childName: string;
  bookName: string | null;
  unitName: string;
  progressText: string | null;
  dateText: string;
  rate: number;
  tier: ReportTier;
  rankText: string;
  totalWords: number;
  dictTotal: number;
  firstTryCorrect: number;
  minutes: number;
  mastered: ReportWord[];
  weak: WeakWord[];
  suggestions: string[];
}

const WEEKDAY = '日一二三四五六';

function dateTextOf(d: Date): string {
  return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEKDAY[d.getDay()]}`;
}

/** 从拼错的词里挑最常见的一类错误给一条建议;一类都认不出就不给 */
function spellingTip(weak: WeakWord[]): string | null {
  const groups = new Map<Exclude<SpellingIssue, 'other'>, WeakWord[]>();
  for (const w of weak) {
    if (!w.wrote) continue;
    const issue = spellingIssueOf(w.word, w.wrote);
    if (issue === 'other') continue;
    groups.set(issue, [...(groups.get(issue) ?? []), w]);
  }
  let best: [Exclude<SpellingIssue, 'other'>, WeakWord[]] | null = null;
  for (const entry of groups) {
    if (!best || entry[1].length > best[1].length) best = entry;
  }
  if (!best) return null;
  const [issue, list] = best;
  const eg = `如 ${list[0].word} 写成了 ${list[0].wrote}`;
  return ISSUE_TIP[issue](list.length, eg);
}

export function buildLearningReport(input: ReportInput): LearningReport {
  const seen = new Set<number>();
  const words = input.words.filter(w => (seen.has(w.id) ? false : (seen.add(w.id), true)));
  const firstTry = new Map(input.dictation.map(r => [r.wordId, r]));

  const mastered: ReportWord[] = [];
  const weak: WeakWord[] = [];
  for (const w of words) {
    const r = firstTry.get(w.id);
    const meaning = shortMeaning(w.meaning);
    if (r && !r.isCorrect) {
      const wrote = r.userInput?.trim();
      weak.push({ id: w.id, word: w.word, meaning, wrote: wrote && wrote !== w.word ? wrote : null });
    } else {
      // 每组的词都会进听写;取不到首答的(理论上没有)按没错处理,不冤枉孩子
      mastered.push({ id: w.id, word: w.word, meaning });
    }
  }

  const dictTotal = input.dictation.length;
  const firstTryCorrect = input.dictation.filter(r => r.isCorrect).length;
  // 与 ClassifySummary.overallRate 同一个公式(含「没有听写记录算 100」)
  const rate = dictTotal > 0 ? Math.round((firstTryCorrect / dictTotal) * 100) : 100;
  const tier = tierOf(rate);

  const suggestions: string[] = [];
  if (weak.length === 0) {
    suggestions.push(`这次 ${words.length} 个词全部第一次就拼对了,可以好好夸夸孩子。`);
    suggestions.push('学过的词隔一天、隔一周各复习一次,忘得会慢很多。');
  } else {
    if (tier === 'excellent') suggestions.push(`今天状态很好,${rate}% 的词第一次就拼对了,值得夸一夸。`);
    else if (tier === 'good') suggestions.push(`大部分词已经会了,剩下 ${weak.length} 个词再练一两次会熟很多。`);
    else suggestions.push('这一课的词对孩子有点难,建议分两三次复习,每次少练几个,别要求一次全对,多鼓励。');
    suggestions.push(`今晚花 5 分钟:您念「还要多练」里的中文,让孩子写出英文,对照这张图检查。`);
    suggestions.push(spellingTip(weak) ?? '拼错的词会进孩子的错题集,学生端首页「错题集」里可以再练。');
  }

  return {
    childName: input.childName.trim(),
    bookName: input.bookName?.trim() || null,
    unitName: input.unitName.trim(),
    progressText: input.progressText?.trim() || null,
    dateText: dateTextOf(input.at ?? new Date()),
    rate,
    tier,
    rankText: rankTextOf(rate),
    totalWords: words.length,
    dictTotal,
    firstTryCorrect,
    minutes: Math.max(1, Math.round(input.elapsedSeconds / 60)),
    mastered,
    weak,
    suggestions,
  };
}

/** 文字版(图画不出来、或家长那边看图不方便时复制发送)。与图同一份数据,不另算 */
export function reportText(r: LearningReport, orgName: string | null): string {
  const head = r.childName ? `【${r.childName}的学习报告】` : '【今日学习报告】';
  const where = [r.bookName, r.unitName, r.progressText].filter(Boolean).join(' · ');
  const lines = [
    `${head}${r.dateText}`,
    where,
    `得分 ${r.rate} 分(${r.rankText}):学了 ${r.totalWords} 个词,听写一次拼对 ${r.firstTryCorrect}/${r.dictTotal},专注学习 ${r.minutes} 分钟。`,
  ];
  if (r.weak.length > 0) {
    const list = r.weak.map(w => `${w.word}${w.meaning ? ` ${w.meaning}` : ''}${w.wrote ? `(写成 ${w.wrote})` : ''}`);
    lines.push(`还要多练(${r.weak.length} 个):${list.join(';')}`);
  } else {
    lines.push('这次没有拼错的词。');
  }
  lines.push('给家长的建议:');
  r.suggestions.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  if (orgName) lines.push(`—— ${orgName}`);
  return lines.filter(Boolean).join('\n');
}
