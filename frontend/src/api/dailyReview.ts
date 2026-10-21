/** 每日复习: 一天固定一份 20 个词,先挑最该复习的。规则真源 backend services/daily_review.py */
import client from './client';
import type { ReviewWord } from './memoryCurve';

export interface DailyReview {
  date: string;
  /** 今天这一份几个词(到期的不够 20 个时更少;0 = 今天没有要复习的) */
  total: number;
  done: number;
  remaining: number;
  /** 挑的时候一共有多少个到期没复习(按拼写去重) */
  backlog: number;
  completed: boolean;
  size: number;
  /** words=true 时带上: 还没复习的词,按优先级 */
  words?: ReviewWord[];
}

export const getDailyReview = (withWords = false): Promise<DailyReview> =>
  client.get('/student/daily-review', { params: withWords ? { words: true } : undefined });
