/**
 * 「今日学习报告」—— 孩子做完当天全部任务后发给家长的那张图,决定「写什么」
 *
 * 数据来自 GET /student/today-report(口径真源 backend services/today_report.py),
 * 图由 components/report/TodayReportDialog 画。与分类学习的「学习报告」同套路:
 * - 不写「已掌握」,只写「一次都没错 / 还要多练」(当天做对 ≠ 记住了)
 * - 建议都是家长能照着做的动作,不承诺分数
 * - 名字取法与学习报告同一份(reportChildName)
 */
import type { TodayReportData, TodayReportTask } from '../api/todayReport';
import { dateTextOf, shortMeaning, spellingTip, tierOf, type ReportTier } from './learningReport';

export interface TodayReport {
  childName: string;
  dateText: string;
  tier: ReportTier;
  todayTotal: number;
  todayDone: number;
  allDone: boolean;
  tasks: Array<TodayReportTask & { line: string; sub: string }>;
  wordsLearned: number;
  minutes: number;
  scoredWords: number;
  neverWrong: number;
  weakTotal: number;
  weak: Array<{ word: string; meaning: string | null; wrote: string | null }>;
  suggestions: string[];
}

/** left = 今天还没做完的任务份数(open 时为 0) */
export interface LearningReportGate { open: boolean; left: number }

/**
 * 分类学习那张「学习报告」能不能生成(用户 2026-10-22: 没做完老师布置的任务就没有学习报告)。
 * 口径与今日学习报告同一份数据: 今天开放的任务(含在家做的、句子/音标/复习作业)全部达标才给;
 * 今天没布置任务 = 没有没做完的,照常给。次数用完没达标(failed)的也算没做完
 */
export function learningReportGate(data: TodayReportData): LearningReportGate {
  if (data.today_total === 0 || data.all_done) return { open: true, left: 0 };
  return { open: false, left: Math.max(1, data.today_total - data.today_done) };
}

/** 单词作业有分数;句子/音标视频/每日复习作业只有做没做完 */
export const hasScore = (t: TodayReportTask) => t.kind === 'word';

function taskLine(t: TodayReportTask): string {
  const group = t.group_index ? ` · 第 ${t.group_index} 组` : '';
  return `${t.unit_name}${group}`;
}

function taskSub(t: TodayReportTask): string {
  const bits = [t.book_name];
  if (t.location_type === 'home') bits.push('在家做');
  if (!t.is_today) bits.push('补做');
  if (t.completed_time) bits.push(`${t.completed_time} 完成`);
  return bits.join(' · ');
}

export function buildTodayReport(data: TodayReportData, childName: string, at: Date = new Date()): TodayReport {
  // 档位(配色/插画)按今天这几份任务的平均得分 —— 图上大字写的是「全部完成」、每份任务列着分数,
  // 按「一次都没错」的比例定档会出现「2/2 全部完成」却是「继续加油」配色的怪图
  // 句子/音标/复习作业没有分数,不拿 0 分去拉低平均
  const todayScores = data.tasks.filter(t => t.is_today && hasScore(t)).map(t => t.best_score);
  const rate = todayScores.length > 0
    ? Math.round(todayScores.reduce((s, x) => s + x, 0) / todayScores.length) : 100;
  const weak = data.weak.map(w => ({ word: w.word, meaning: shortMeaning(w.meaning), wrote: w.wrote }));

  const suggestions: string[] = [];
  const doneCount = data.tasks.filter(t => t.status === 'completed').length;
  suggestions.push(`今天老师布置的 ${data.today_total} 份任务孩子都完成了${doneCount > data.today_done ? ',还补做了之前的任务' : ''},可以好好夸一夸。`);
  if (data.weak_total > 0) {
    suggestions.push('睡前花 5 分钟:您念「还要多练」里的中文,让孩子写出英文,对照这张图检查。');
    suggestions.push(spellingTip(weak) ?? '答错的词会进孩子的错题集,学生端首页「错题集」里可以再练。');
  } else {
    suggestions.push('学过的词隔一天、隔一周各复习一次,忘得会慢很多。');
  }

  return {
    childName: childName.trim(),
    dateText: dateTextOf(at),
    tier: tierOf(rate),
    todayTotal: data.today_total,
    todayDone: data.today_done,
    allDone: data.all_done,
    tasks: data.tasks.map(t => ({ ...t, line: taskLine(t), sub: taskSub(t) })),
    wordsLearned: data.words_learned,
    minutes: Math.max(1, Math.round(data.study_seconds / 60)),
    scoredWords: data.scored_words,
    neverWrong: data.never_wrong,
    weakTotal: data.weak_total,
    weak,
    suggestions,
  };
}

/** 文字版(图画不出来、或家长那边看图不方便时复制发送)。与图同一份数据,不另算 */
export function todayReportText(r: TodayReport, orgName: string | null): string {
  const head = r.childName ? `【${r.childName}的今日学习报告】` : '【今日学习报告】';
  const lines = [
    `${head}${r.dateText}`,
    `今天的 ${r.todayTotal} 份任务全部完成:学了 ${r.wordsLearned} 个词,学习 ${r.minutes} 分钟。`,
    ...r.tasks.map((t, i) => `${i + 1}. ${t.line}(${t.sub}${t.status === 'completed' && hasScore(t) ? ` · ${t.best_score} 分` : ''})`),
  ];
  if (r.weakTotal > 0) {
    const list = r.weak.map(w => `${w.word}${w.meaning ? ` ${w.meaning}` : ''}${w.wrote ? `(写成 ${w.wrote})` : ''}`);
    const more = r.weakTotal > r.weak.length ? ` 等 ${r.weakTotal} 个` : '';
    lines.push(`还要多练:${list.join(';')}${more}`);
  } else if (r.scoredWords > 0) {
    lines.push(`今天做过的 ${r.scoredWords} 个词一次都没错。`);
  }
  lines.push('给家长的建议:');
  r.suggestions.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  if (orgName) lines.push(`—— ${orgName}`);
  return lines.join('\n');
}
