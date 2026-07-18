import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import './_axiosBootstrap';
import { submitReliably } from './submitQueue';

// ========================================
// 学习记录相关类型定义
// ========================================

export interface WordAnswerCreate {
  word_id: number;
  is_correct: boolean;
  time_spent: number; // 毫秒
  learning_mode: string; // flashcard/quiz/spelling/fillblank
  user_answer?: string; // 答错时的实际输入(拼写/听写),拼写错误模式诊断用
}

export interface LearningRecordBatchCreate {
  unit_id: number;
  learning_mode: string;
  records: WordAnswerCreate[];
  // 本次提交对应的「增量净活动秒数」(已扣挂机),用于日历时长统计。不传则后端退回按 time_spent 累加
  session_seconds?: number;
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
 * 走可靠提交队列:断网/重启部署/5xx 时先落本地,恢复后带幂等键自动补交,不丢不重
 */
export const createLearningRecords = async (
  data: LearningRecordBatchCreate
): Promise<{ success: boolean; message: string; records_created: number }> => {
  return submitReliably('/student/records', data);
};

/**
 * 提交错题练习结果（答对直接标记为已解决，移出待攻克）
 */
export const submitMistakePracticeRecord = async (
  wordId: number,
  isCorrect: boolean,
  userAnswer?: string,
): Promise<void> => {
  if (isCorrect) {
    // 答对 → 直接标记为已解决（mastery_level=4），移出待攻克
    await axios.delete(`${API_BASE_URL}/student/mistake-book/words/${wordId}`);
  } else {
    // 答错 → 仅记录错误，不改变解决状态(拼写题型带上真实输入,供诊断)
    await axios.post(`${API_BASE_URL}/student/review-records`, {
      records: [{ word_id: wordId, is_correct: false, learning_mode: 'quiz', time_spent: 0, user_answer: userAnswer || undefined }],
    });
  }
};

/**
 * 上报纯学习时长(句子背诵等没有逐题落库的场景),计入学习日历。
 * 走可靠队列:断网/关页后下次打开自动补交,幂等键防重复计时。
 */
export const reportStudyTime = async (sessionSeconds: number): Promise<void> => {
  if (!sessionSeconds || sessionSeconds <= 0) return;
  await submitReliably('/student/study-time', { session_seconds: Math.round(sessionSeconds) });
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
 * PUT 绝对值天然幂等,走队列重发无副作用(不带去重键)
 */
export const updateStudySession = async (
  sessionId: number,
  data: StudySessionUpdate
): Promise<StudySessionResponse> => {
  if (!sessionId && sessionId !== 0) {
    // 防御:历史上出现过 sessions/undefined 422 刷日志
    return Promise.reject(new Error('sessionId 缺失'));
  }
  return submitReliably(`/student/sessions/${sessionId}`, data, {
    method: 'put',
    dedupe: false,
    staleKey: `session:${sessionId}`,
  });
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

/**
 * 上报一次小组过关检测成绩(仅正常学习流程调用,复习/错题模式不调)
 */
export const submitGroupExamRecord = async (payload: {
  unit_id: number | null;
  group_index: number;
  correct_count: number;
  total_questions: number;
  score: number;
  time_spent: number;
}): Promise<{ success: boolean; id: number }> => {
  return submitReliably('/student/group-exam-record', payload);
};
