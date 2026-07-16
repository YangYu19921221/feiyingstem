import client from './client';
import type { WordAnswerCreate } from './learningRecords';
import { submitReliably } from './submitQueue';

export interface MemoryCurveStats {
  due_today: number;
  due_tomorrow: number;
  upcoming_7_days: {
    date: string;
    weekday: string;
    count: number;
    is_today: boolean;
  }[];
  stage_distribution: {
    stage: number;
    label: string;
    count: number;
  }[];
  total_learned: number;
  total_mastered: number;
  retention_rate: number;
  /** 一周前学的词: 隔天复习过 vs 没复习 的保持率对比(样本不足时后端返回 null) */
  retention_compare?: {
    reviewed: { total: number; rate: number };
    unreviewed: { total: number; rate: number };
  } | null;
}

export interface ReviewWord {
  mastery_id: number;
  word_id: number;
  mastery_level: number;
  review_stage: number;
  next_review_at: string | null;
  last_practiced_at: string | null;
  word: string;
  phonetic: string | null;
  syllables: string | null;
  meaning: string | null;
  part_of_speech: string | null;
  example_sentence: string | null;
  example_translation: string | null;
  difficulty: number;
}

// 获取记忆曲线统计数据
export const getMemoryCurveStats = async (): Promise<MemoryCurveStats> => {
  return client.get('/student/memory-curve-stats');
};

// 获取今日待复习数量（轻量级）
export const getReviewDueCount = async (): Promise<{ due_today: number }> => {
  return client.get('/student/review-due-count');
};

export interface ReviewProgress {
  review_due_today: number;
  review_done_today: number;
  graduated_words: number;
}

// 复习进度（学生 / 家长 / 教师同口径）
export const getReviewProgress = async (): Promise<ReviewProgress> => {
  return client.get('/student/review-progress');
};

// 获取需要复习的单词
export const getReviewDueWords = async (limit: number = 20, randomize: boolean = false): Promise<ReviewWord[]> => {
  const qs = new URLSearchParams({ limit: String(limit), randomize: String(randomize) }).toString();
  return client.get(`/student/review-due?${qs}`);
};

// 提交复习记录
// sessionSeconds: 本次提交对应的「增量净活动秒数」(已扣挂机),用于日历时长统计
// 走可靠提交队列:失败先落本地,恢复后带幂等键自动补交(复习模式存档曾因 404 全丢过,不能再丢)
export const submitReviewRecords = async (
  records: WordAnswerCreate[],
  sessionSeconds?: number,
): Promise<any> => {
  return submitReliably('/student/review-records', { records, session_seconds: sessionSeconds });
};
