import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import type { StudentMistakeAnalysis, ExamPaper, GenerateExamRequest } from '../types/exam';

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
// 教师端单元管理API
// ========================================

// 单元相关类型定义
export interface UnitCreate {
  unit_number: number;
  name: string;
  description?: string;
  order_index?: number;
}

export interface UnitUpdate {
  name?: string;
  description?: string;
  order_index?: number;
}

export interface UnitResponse {
  id: number;
  book_id: number;
  unit_number: number;
  name: string;
  description: string | null;
  order_index: number;
  word_count: number;
  created_at: string;
  updated_at: string;
}

export interface WordInUnit {
  id: number;
  word: string;
  phonetic: string | null;
  syllables: string | null;
  difficulty: number;
  order_index: number;
  meaning: string | null;
  part_of_speech: string | null;
  example_sentence: string | null;
  example_translation: string | null;
}

export interface UnitDetailResponse {
  id: number;
  book_id: number;
  unit_number: number;
  name: string;
  description: string | null;
  order_index: number;
  word_count: number;
  words: WordInUnit[];
  created_at: string;
  updated_at: string;
}

export interface UnitWordAdd {
  word_ids: number[];
}

export interface UnitWordAddResponse {
  success: boolean;
  message: string;
  added_count: number;
  unit_id: number;
  total_words: number;
}

// ========================================
// 单元管理API函数
// ========================================

/**
 * 创建单元
 * POST /api/v1/teacher/books/{book_id}/units
 */
export const createUnit = async (bookId: number, unitData: UnitCreate): Promise<UnitResponse> => {
  const response = await axios.post(
    `${API_BASE_URL}/teacher/books/${bookId}/units`,
    unitData
  );
  return response.data;
};

/**
 * 获取单词本下的所有单元
 * GET /api/v1/teacher/books/{book_id}/units
 */
export const getUnitsByBook = async (bookId: number): Promise<UnitResponse[]> => {
  const response = await axios.get(`${API_BASE_URL}/teacher/books/${bookId}/units`);
  return response.data;
};

/**
 * 获取单元详情(包含单词列表)
 * GET /api/v1/teacher/units/{unit_id}
 */
export const getUnitDetail = async (unitId: number): Promise<UnitDetailResponse> => {
  const response = await axios.get(`${API_BASE_URL}/teacher/units/${unitId}`);
  return response.data;
};

/**
 * 更新单元信息
 * PUT /api/v1/teacher/units/{unit_id}
 */
export const updateUnit = async (unitId: number, unitData: UnitUpdate): Promise<UnitResponse> => {
  const response = await axios.put(
    `${API_BASE_URL}/teacher/units/${unitId}`,
    unitData
  );
  return response.data;
};

/**
 * 删除单元
 * DELETE /api/v1/teacher/units/{unit_id}
 */
export const deleteUnit = async (unitId: number): Promise<void> => {
  await axios.delete(`${API_BASE_URL}/teacher/units/${unitId}`);
};

/**
 * 为单元添加单词
 * POST /api/v1/teacher/units/{unit_id}/words
 */
export const addWordsToUnit = async (
  unitId: number,
  wordIds: number[]
): Promise<UnitWordAddResponse> => {
  const response = await axios.post(
    `${API_BASE_URL}/teacher/units/${unitId}/words`,
    { word_ids: wordIds }
  );
  return response.data;
};

/**
 * 从单元中移除单词
 * DELETE /api/v1/teacher/units/{unit_id}/words/{word_id}
 */
export const removeWordFromUnit = async (unitId: number, wordId: number): Promise<void> => {
  await axios.delete(`${API_BASE_URL}/teacher/units/${unitId}/words/${wordId}`);
};

/**
 * 编辑单元中的单词
 * PUT /api/v1/teacher/units/{unit_id}/words/{word_id}
 */
export const updateWordInUnit = async (
  unitId: number,
  wordId: number,
  wordData: {
    word?: string;
    phonetic?: string;
    syllables?: string;
    difficulty?: number;
    meaning?: string;
    part_of_speech?: string;
    example_sentence?: string;
    example_translation?: string;
  }
): Promise<void> => {
  await axios.put(`${API_BASE_URL}/teacher/units/${unitId}/words/${wordId}`, wordData);
};

// ========================================
// 单词本相关API (使用现有的words API)
// ========================================

export interface TeacherWordBook {
  id: number;
  name: string;
  description: string | null;
  grade_level: string | null;
  volume: string | null;
  cover_color: string;
  created_by: number;
  created_at: string;
  updated_at: string;
}

/**
 * 获取教师创建的所有单词本
 * GET /api/v1/words/books
 */
export const getTeacherWordBooks = async (): Promise<TeacherWordBook[]> => {
  const response = await axios.get(`${API_BASE_URL}/words/books`);
  return response.data;
};

/**
 * 获取所有单词(用于添加到单元)
 * GET /api/v1/words/
 */
export interface WordSimple {
  id: number;
  word: string;
  phonetic: string | null;
  difficulty: number;
  meanings?: Array<{
    part_of_speech: string;
    meaning: string;
  }>;
}

export const getAllWords = async (limit: number = 100, skip: number = 0): Promise<WordSimple[]> => {
  const response = await axios.get(`${API_BASE_URL}/words/`, {
    params: { limit: Math.min(limit, 100), skip }
  });
  return response.data;
};

// ========================================
// 学生管理API
// ========================================

export interface StudentInfo {
  id: number;
  username: string;
  full_name: string;
  email?: string;
  created_at: string;
}

/**
 * 获取所有学生列表
 * GET /api/v1/teacher/students
 */
export const getStudentsList = async (): Promise<StudentInfo[]> => {
  const response = await axios.get(`${API_BASE_URL}/teacher/students`);
  return response.data;
};

// 已通过顶层export interface导出类型

// ========================================
// AI试卷生成API
// ========================================

/**
 * 分析学生错题情况
 * POST /api/v1/teacher/analyze-mistakes/{student_id}
 */
export const analyzeStudentMistakes = async (studentId: number): Promise<StudentMistakeAnalysis> => {
  const response = await axios.post(`${API_BASE_URL}/teacher/analyze-mistakes/${studentId}`);
  return response.data;
};

/**
 * AI生成个性化试卷
 * POST /api/v1/teacher/generate-exam
 */
export const generatePersonalizedExam = async (request: GenerateExamRequest): Promise<ExamPaper> => {
  const response = await axios.post(`${API_BASE_URL}/teacher/generate-exam`, request);
  return response.data;
};

/**
 * 获取试卷详情
 * GET /api/v1/teacher/exams/{exam_id}
 */
export const getExamDetail = async (examId: number): Promise<ExamPaper> => {
  const response = await axios.get(`${API_BASE_URL}/teacher/exams/${examId}`);
  return response.data;
};

/**
 * 获取学生的试卷列表
 * GET /api/v1/teacher/students/{student_id}/exams
 */
export const getStudentExams = async (studentId: number, skip: number = 0, limit: number = 20) => {
  const response = await axios.get(`${API_BASE_URL}/teacher/students/${studentId}/exams`, {
    params: { skip, limit }
  });
  return response.data;
};

/**
 * 批量预缓存单元发音
 * POST /api/v1/teacher/units/{unit_id}/cache-pronunciations
 */
export interface CachePronunciationsResponse {
  total: number;
  cambridge: number;
  edge_tts: number;
  failed: string[];
  message: string;
}

export const cacheUnitPronunciations = async (unitId: number): Promise<CachePronunciationsResponse> => {
  const response = await axios.post(`${API_BASE_URL}/teacher/units/${unitId}/cache-pronunciations`);
  return response.data;
};
