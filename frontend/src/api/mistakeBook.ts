import api from './client';

// ========================================
// 错题集相关类型定义
// ========================================

export interface MistakeWordDetail {
  word_id: number;
  word: string;
  phonetic: string | null;
  meaning: string;
  part_of_speech: string | null;

  // 错题统计
  total_mistakes: number;
  recent_mistakes: number;
  last_mistake_at: string | null;

  // 掌握度信息
  mastery_level: number;
  correct_count: number;
  wrong_count: number;

  // 错误模式统计
  flashcard_wrong: number;
  quiz_wrong: number;
  spelling_wrong: number;
  fillblank_wrong: number;

  // 是否已解决
  is_resolved: boolean;
}

export interface MistakeWordPage {
  items: MistakeWordDetail[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface MistakeBookStats {
  total_mistakes: number;
  unresolved_mistakes: number;
  resolved_mistakes: number;

  // 按学习模式分类
  flashcard_mistakes: number;
  quiz_mistakes: number;
  spelling_mistakes: number;
  fillblank_mistakes: number;
  classify_mistakes: number; // 分类学习夹生/陌生词

  // 时间统计
  today_practice_count: number;
  week_practice_count: number;
}

export interface MistakePracticeRequest {
  learning_mode: string; // flashcard/quiz/spelling/fillblank
  limit?: number; // 默认20
  only_unresolved?: boolean; // 默认true
  unit_id?: number; // 可选
}

export interface MistakePracticeResponse {
  total_mistakes: number;
  practice_words: MistakeWordDetail[];
  message: string;
}

// ========================================
// API函数
// ========================================

/**
 * 获取错题集统计信息
 */
export const getMistakeBookStats = async (): Promise<MistakeBookStats> => {
  return api.get('/student/mistake-book/stats');
};

/**
 * 获取错题单词列表（分页）
 */
export const getMistakeWords = async (
  onlyUnresolved: boolean = true,
  unitId?: number,
  page: number = 1,
  pageSize: number = 20,
  source: 'all' | 'classify' = 'all'
): Promise<MistakeWordPage> => {
  let url = `/student/mistake-book/words?only_unresolved=${onlyUnresolved}&page=${page}&page_size=${pageSize}&source=${source}`;
  if (unitId) {
    url += `&unit_id=${unitId}`;
  }
  return api.get(url);
};

/**
 * 开始错题练习
 */
export const startMistakePractice = async (
  request: MistakePracticeRequest
): Promise<MistakePracticeResponse> => {
  return api.post('/student/mistake-book/practice', request);
};

/**
 * 标记错题为已解决
 */
export const markMistakeAsResolved = async (wordId: number): Promise<{
  success: boolean;
  message: string;
}> => {
  return api.delete(`/student/mistake-book/words/${wordId}`);
};

// 类型已在文件顶部导出

// ===== 闯关模式 =====

export interface ChallengeLevelWord {
  word_id: number;
  word: string;
  meaning: string;
  phonetic: string | null;
  part_of_speech: string | null;
}

export interface ChallengeLevel {
  level: number;
  status: 'locked' | 'unlocked' | 'cleared' | 'review';
  words: ChallengeLevelWord[];
  word_count: number;
}

export interface ChallengeLevelsResponse {
  levels: ChallengeLevel[];
  total_levels: number;
  cleared_levels: number;
  total_unresolved: number;
  message: string;
}

export interface ChallengeSubmitResult {
  passed: boolean;
  correct_count: number;
  total_count: number;
  wrong_words: ChallengeLevelWord[];
  message: string;
}

/**
 * 获取闯关关卡列表
 */
export const getChallengeLevels = async (): Promise<ChallengeLevelsResponse> => {
  return api.get('/student/mistake-book/challenge-levels');
};

/**
 * 提交闯关答题结果
 */
export const submitChallengeLevel = async (
  level: number,
  answers: { word_id: number; user_answer: string }[]
): Promise<ChallengeSubmitResult> => {
  return api.post(
    '/student/mistake-book/challenge-submit',
    { level, answers }
  );
};

/**
 * 获取闯关复习到期数量
 */
export const getChallengeReviewDue = async (): Promise<{ due_count: number }> => {
  return api.get('/student/mistake-book/challenge-review-due');
};
