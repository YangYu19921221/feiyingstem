import axios from 'axios';
import { API_BASE_URL } from '../config/env';

// 创建axios实例
const apiClient = axios.create({
  baseURL: API_BASE_URL,
});

// 配置axios拦截器,自动添加token
apiClient.interceptors.request.use(
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

// 响应拦截器 - 统一处理错误
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // 提取友好的错误信息
    if (error.response?.data?.detail) {
      // 创建新的错误对象,包含后端返回的详细信息
      const friendlyError = new Error(error.response.data.detail);
      friendlyError.name = error.name;
      return Promise.reject(friendlyError);
    }
    return Promise.reject(error);
  }
);

// ========================================
// 学生端学习进度API
// ========================================


export interface StartLearningRequest {
  unit_id: number;
  learning_mode: string;
}

export interface WordData {
  id: number;
  word: string;
  phonetic: string | null;
  syllables: string | null;
  difficulty: number;
  audio_url: string | null;
  image_url: string | null;
  order_index: number;
  meaning: string | null;
  part_of_speech: string | null;
  example_sentence: string | null;
  example_translation: string | null;
}

export interface StartLearningResponse {
  has_existing_progress: boolean;
  current_word_index: number;
  completed_words: number;
  total_words: number;
  progress_percentage: number;
  words: WordData[];
  message: string;
  unit_info: {
    id: number;
    unit_number: number;
    name: string;
    description: string | null;
    book_id: number;
    grade_level: string | null;
  };
}

export interface UpdateProgressRequest {
  unit_id: number;
  learning_mode: string;
  current_word_index: number;
  current_word_id?: number;
  word_result?: string;
  is_completed: boolean;
}

export interface UpdateProgressResponse {
  success: boolean;
  message: string;
  progress_percentage: number;
  completed_words: number;
  total_words: number;
  is_completed: boolean;
}

export interface UnitProgress {
  unit_id: number;
  unit_number: number;
  unit_name: string;
  word_count: number;
  completed_words: number;
  progress_percentage: number;
  has_progress: boolean;
  current_word_index: number;
  last_studied_at: string | null;
  learning_mode: string | null;
  is_completed: boolean;
  best_accuracy: number | null;
  is_perfect: boolean;
}

export interface BookProgress {
  book_id: number;
  book_name: string;
  unit_count: number;
  word_count: number;
  completed_words: number;
  progress_percentage: number;
  units: UnitProgress[];
}

export interface StudentBook {
  id: number;
  name: string;
  description: string | null;
  grade_level: string | null;
  volume: string | null;
  cover_color: string;
  unit_count: number;
  word_count: number;
  progress_percentage: number;
  owned: boolean;
  created_at: string;
}

// API函数

export const startLearning = async (request: StartLearningRequest): Promise<StartLearningResponse> => {
  const response = await apiClient.post(
    `/student/units/${request.unit_id}/start`,
    { learning_mode: request.learning_mode }  // 只发送learning_mode,unit_id已在URL中
  );
  return response.data;
};

export const updateProgress = async (request: UpdateProgressRequest): Promise<UpdateProgressResponse> => {
  const response = await apiClient.put(`/student/progress`, request);
  return response.data;
};

export const getBookProgress = async (bookId: number): Promise<BookProgress> => {
  const response = await apiClient.get(`/student/books/${bookId}/progress`);
  return response.data;
};

export const getUnitProgress = async (unitId: number, learningMode: string): Promise<UnitProgress> => {
  const response = await apiClient.get(
    `/student/units/${unitId}/progress?learning_mode=${learningMode}`
  );
  return response.data;
};

export const getStudentBooks = async (): Promise<StudentBook[]> => {
  const response = await apiClient.get(`/student/books`);
  return response.data;
};

// 类型已在文件顶部使用export interface导出
