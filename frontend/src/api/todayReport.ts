/** 今日学习报告(孩子做完当天全部任务后发给家长的分享图)。口径见 backend services/today_report.py */
import api from './client';

export interface TodayReportTask {
  id: number;
  /** word = 单词作业(有分数);其余是句子/音标视频/每日复习作业,没有分数,unit_name 是内容名 */
  kind: 'word' | 'sentence' | 'phonetic_video' | 'daily_review';
  title: string;
  book_name: string;
  unit_name: string;
  /** 按组布置的作业:组号(1 基);整单元为 null */
  group_index: number | null;
  learning_mode: string;
  status: string;
  best_score: number;
  target_score: number;
  /** 'home'=在家做的 */
  location_type: string;
  /** false = 之前布置、今天补做完成的 */
  is_today: boolean;
  /** 完成时间(北京 HH:MM);没完成为 null */
  completed_time: string | null;
}

export interface TodayReportData {
  date: string;
  org_name: string | null;
  /** 今天布置的任务至少一份且全部达标 */
  all_done: boolean;
  today_total: number;
  today_done: number;
  tasks: TodayReportTask[];
  /** 今天学了多少词(全站唯一口径 daily_words) */
  words_learned: number;
  /** 今天学了多少秒(全站唯一口径 study_time) */
  study_seconds: number;
  /** 今天在计分模式里做过的词数(按拼写去重) */
  scored_words: number;
  /** 其中今天一次都没错的 */
  never_wrong: number;
  weak_total: number;
  /** 今天答错过的词(封顶 200);wrote = 当天第一次拼错写成的样子 */
  weak: Array<{ word: string; meaning: string | null; wrote: string | null }>;
}

export const getTodayReport = () => api.get<TodayReportData>('/student/today-report');
