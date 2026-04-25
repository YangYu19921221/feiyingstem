import client from './client';
import type { WordAnswerCreate } from './learningRecords';

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

// 获取需要复习的单词
export const getReviewDueWords = async (limit: number = 20, randomize: boolean = false): Promise<ReviewWord[]> => {
  const qs = new URLSearchParams({ limit: String(limit), randomize: String(randomize) }).toString();
  return client.get(`/student/review-due?${qs}`);
};

// 提交复习记录
export const submitReviewRecords = async (records: WordAnswerCreate[]): Promise<any> => {
  return client.post('/student/review-records', { records });
};
