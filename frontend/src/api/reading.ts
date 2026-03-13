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
// 类型定义
// ========================================

export interface ReadingPassage {
  id: number;
  title: string;
  content: string;
  content_translation?: string;
  difficulty: number;
  grade_level?: string;
  word_count: number;
  topic?: string;
  tags?: string[];
  cover_image?: string;
  view_count: number;
  completion_count: number;
  avg_score: number;
  created_at: string;
  is_public?: boolean;
}

export interface VocabularyItem {
  id: number;
  word: string;
  meaning?: string;
  phonetic?: string;
  context?: string;
  position?: number;
  is_key_vocabulary: boolean;
}

export interface QuestionOption {
  id: number;
  option_text: string;
  option_label: string;
  is_correct: boolean;
  order_index: number;
}

export interface ReadingQuestion {
  id: number;
  passage_id: number;
  question_type: string; // multiple_choice | true_false | fill_blank | short_answer
  question_text: string;
  order_index: number;
  points: number;
  options: QuestionOption[];
}

export interface ReadingPassageDetail extends ReadingPassage {
  vocabularies: VocabularyItem[];
  questions: ReadingQuestion[];
}

export interface StudentPassageListItem {
  id: number;
  title: string;
  topic?: string;
  difficulty: number;
  grade_level?: string;
  word_count: number;
  question_count: number;
  cover_image?: string;
  is_assigned: boolean;
  is_started: boolean;
  is_completed: boolean;
  best_score?: number;
  attempts_count: number;
  deadline?: string;
}

export interface AnswerSubmission {
  question_id: number;
  answer: string;
}

export interface SubmitReadingAttempt {
  passage_id: number;
  answers: AnswerSubmission[];
  time_spent: number;
  assignment_id?: number;
}

export interface QuestionResult {
  question_id: number;
  is_correct: boolean;
  user_answer: string;
  correct_answer: string;
  explanation?: string;
  points: number;
  earned_points: number;
}

export interface ReadingAttemptResult {
  attempt_id: number;
  score: number;
  total_points: number;
  percentage: number;
  is_passed: boolean;
  question_results: QuestionResult[];
}

export interface ReadingAttempt {
  id: number;
  attempt_number: number;
  score: number;
  total_points: number;
  percentage: number;
  is_passed: boolean;
  time_spent: number;
  started_at: string;
  submitted_at: string;
}

// ========================================
// 学生端API
// ========================================

export const getStudentPassages = async (params?: {
  topic?: string;
  difficulty?: number;
  only_assigned?: boolean;
}): Promise<StudentPassageListItem[]> => {
  const response = await axios.get(`${API_BASE_URL}/student/reading/passages`, { params });
  return response.data;
};

export const getPassageDetail = async (passageId: number): Promise<ReadingPassageDetail> => {
  const response = await axios.get(`${API_BASE_URL}/student/reading/passages/${passageId}`);
  return response.data;
};

export const submitReadingAttempt = async (
  submission: SubmitReadingAttempt
): Promise<ReadingAttemptResult> => {
  const response = await axios.post(`${API_BASE_URL}/student/reading/submit`, submission);
  return response.data;
};

export const getReadingAttempts = async (passageId: number): Promise<ReadingAttempt[]> => {
  const response = await axios.get(`${API_BASE_URL}/student/reading/attempts/${passageId}`);
  return response.data;
};

// ========================================
// 教师端API
// ========================================

export interface CreatePassageRequest {
  title: string;
  content: string;
  content_translation?: string;
  difficulty: number;
  grade_level?: string;
  topic?: string;
  tags?: string[];
  is_public: boolean;
  cover_image?: string;
}

export interface UpdatePassageRequest {
  title?: string;
  content?: string;
  content_translation?: string;
  difficulty?: number;
  grade_level?: string;
  topic?: string;
  tags?: string[];
  is_public?: boolean;
  cover_image?: string;
}

export interface CreateQuestionRequest {
  question_type: string;
  question_text: string;
  order_index: number;
  points: number;
  options?: {
    option_text: string;
    option_label: string;
    is_correct: boolean;
    order_index: number;
  }[];
  answer?: {
    answer_text: string;
    answer_explanation?: string;
    is_primary: boolean;
    accept_alternatives?: string[];
  };
}

export interface AssignReadingRequest {
  passage_id: number;
  student_ids: number[];
  deadline?: string;
  min_score?: number;
  max_attempts: number;
}

export const getTeacherPassages = async (params?: {
  skip?: number;
  limit?: number;
  topic?: string;
  difficulty?: number;
}): Promise<ReadingPassage[]> => {
  const response = await axios.get(`${API_BASE_URL}/teacher/passages`, { params });
  return response.data;
};

export const createPassage = async (data: CreatePassageRequest): Promise<ReadingPassage> => {
  const response = await axios.post(`${API_BASE_URL}/teacher/passages`, data);
  return response.data;
};

export const getTeacherPassageDetail = async (passageId: number): Promise<ReadingPassageDetail> => {
  const response = await axios.get(`${API_BASE_URL}/teacher/passages/${passageId}`);
  return response.data;
};

export const updatePassage = async (
  passageId: number,
  data: UpdatePassageRequest
): Promise<ReadingPassage> => {
  const response = await axios.put(`${API_BASE_URL}/teacher/passages/${passageId}`, data);
  return response.data;
};

export const deletePassage = async (passageId: number): Promise<void> => {
  await axios.delete(`${API_BASE_URL}/teacher/passages/${passageId}`);
};

export const addVocabulary = async (
  passageId: number,
  data: Omit<VocabularyItem, 'id' | 'passage_id'>
): Promise<VocabularyItem> => {
  const response = await axios.post(`${API_BASE_URL}/teacher/passages/${passageId}/vocabulary`, data);
  return response.data;
};

export const deleteVocabulary = async (vocabId: number): Promise<void> => {
  await axios.delete(`${API_BASE_URL}/teacher/vocabulary/${vocabId}`);
};

export const addQuestion = async (
  passageId: number,
  data: CreateQuestionRequest
): Promise<ReadingQuestion> => {
  const response = await axios.post(`${API_BASE_URL}/teacher/passages/${passageId}/questions`, data);
  return response.data;
};

export const deleteQuestion = async (questionId: number): Promise<void> => {
  await axios.delete(`${API_BASE_URL}/teacher/questions/${questionId}`);
};

export const assignReading = async (data: AssignReadingRequest): Promise<any> => {
  const response = await axios.post(`${API_BASE_URL}/teacher/assignments`, data);
  return response.data;
};

export const getPassageAssignments = async (passageId: number): Promise<any[]> => {
  const response = await axios.get(`${API_BASE_URL}/teacher/assignments/passage/${passageId}`);
  return response.data;
};
