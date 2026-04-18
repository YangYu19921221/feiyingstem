import axios from 'axios';
import { API_BASE_URL } from '../config/env';

// 配置axios拦截器,自动添加token
axios.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// ========================================
// 学习记录相关类型定义
// ========================================

export interface WordAnswerCreate {
  word_id: number;
  is_correct: boolean;
  time_spent: number; // 毫秒
  learning_mode: string; // flashcard/quiz/spelling/fillblank
}

export interface LearningRecordBatchCreate {
  unit_id: number;
  learning_mode: string;
  records: WordAnswerCreate[];
}

export interface StudySessionCreate {
  unit_id: number;
  learning_mode: string;
  total_words: number;
}

export interface StudySessionUpdate {
  completed_words: number;
  correct_count: number;
  wrong_count: number;
  total_time: number; // 秒
}

export interface StudySessionResponse {
  id: number;
  user_id: number;
  unit_id: number;
  learning_mode: string;
  total_words: number;
  completed_words: number;
  correct_count: number;
  wrong_count: number;
  total_time: number;
  started_at: string;
  completed_at: string | null;
}

export interface WordMasteryResponse {
  id: number;
  user_id: number;
  word_id: number;
  total_encounters: number;
  correct_count: number;
  wrong_count: number;
  mastery_level: number; // 0-5

  // 各模式统计
  flashcard_correct: number;
  flashcard_wrong: number;
  quiz_correct: number;
  quiz_wrong: number;
  spelling_correct: number;
  spelling_wrong: number;
  fillblank_correct: number;
  fillblank_wrong: number;

  last_practiced_at: string | null;
  next_review_at: string | null;
  created_at: string;
  updated_at: string;
}

// ========================================
// API函数
// ========================================

/**
 * 批量创建学习记录
 */
export const createLearningRecords = async (
  data: LearningRecordBatchCreate
): Promise<{ success: boolean; message: string; records_created: number }> => {
  const response = await axios.post(`${API_BASE_URL}/student/records`, data);
  return response.data;
};

/**
 * 提交错题练习结果（答对直接标记为已解决，移出待攻克）
 */
export const submitMistakePracticeRecord = async (
  wordId: number,
  isCorrect: boolean,
): Promise<void> => {
  if (isCorrect) {
    // 答对 → 直接标记为已解决（mastery_level=4），移出待攻克
    await axios.delete(`${API_BASE_URL}/student/mistake-book/words/${wordId}`);
  } else {
    // 答错 → 仅记录错误，不改变解决状态
    await axios.post(`${API_BASE_URL}/student/review-records`, {
      records: [{ word_id: wordId, is_correct: false, learning_mode: 'quiz', time_spent: 0 }],
    });
  }
};

/**
 * 创建学习会话
 */
export const createStudySession = async (
  data: StudySessionCreate
): Promise<StudySessionResponse> => {
  const response = await axios.post(`${API_BASE_URL}/student/sessions`, data);
  return response.data;
};

/**
 * 更新学习会话
 */
export const updateStudySession = async (
  sessionId: number,
  data: StudySessionUpdate
): Promise<StudySessionResponse> => {
  const response = await axios.put(`${API_BASE_URL}/student/sessions/${sessionId}`, data);
  return response.data;
};

/**
 * 获取单个单词的掌握度
 * 注意: 后端会返回默认值(id=0表示没有记录),不会返回404
 */
export const getWordMastery = async (wordId: number): Promise<WordMasteryResponse> => {
  const response = await axios.get(`${API_BASE_URL}/student/mastery/${wordId}`);
  return response.data;
};

/**
 * 获取所有单词掌握度
 */
export const getAllWordMastery = async (
  unitId?: number
): Promise<WordMasteryResponse[]> => {
  const url = unitId
    ? `${API_BASE_URL}/student/mastery?unit_id=${unitId}`
    : `${API_BASE_URL}/student/mastery`;
  const response = await axios.get(url);
  return response.data;
};

/**
 * 获取薄弱单词 (掌握度 < 3)
 */
export const getWeakWords = async (
  unitId?: number
): Promise<WordMasteryResponse[]> => {
  const url = unitId
    ? `${API_BASE_URL}/student/weak-words?unit_id=${unitId}`
    : `${API_BASE_URL}/student/weak-words`;
  const response = await axios.get(url);
  return response.data;
};

/**
 * 获取需要复习的单词
 */
export const getReviewDueWords = async (
  unitId?: number
): Promise<WordMasteryResponse[]> => {
  const url = unitId
    ? `${API_BASE_URL}/student/review-due?unit_id=${unitId}`
    : `${API_BASE_URL}/student/review-due`;
  const response = await axios.get(url);
  return response.data;
};

// 类型已在文件顶部使用export interface导出
