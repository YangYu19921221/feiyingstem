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

export interface CreateHomeworkRequest {
  title: string;
  description?: string;
  unit_id: number;
  learning_mode: string; // flashcard, spelling, fillblank, quiz
  student_ids: number[];
  target_score: number;
  min_completion_time?: number;
  max_attempts: number;
  deadline?: string;
}

export interface HomeworkResponse {
  id: number;
  title: string;
  description?: string;
  unit_id: number;
  unit_name: string;
  book_name: string;
  learning_mode: string;
  target_score: number;
  min_completion_time?: number;
  max_attempts: number;
  deadline?: string;
  created_at: string;
  total_assigned: number;
  completed_count: number;
  in_progress_count: number;
  pending_count: number;
}

export interface StudentHomeworkStatusResponse {
  id: number;
  homework_id: number;
  student_id: number;
  student_name: string;
  status: string;
  assigned_at: string;
  started_at?: string;
  completed_at?: string;
  attempts_count: number;
  best_score: number;
  total_time_spent: number;
}

export interface StudentHomeworkResponse {
  id: number; // HomeworkStudentAssignment id
  homework_id: number;
  title: string;
  description?: string;
  unit_id: number;
  unit_name: string;
  book_name: string;
  learning_mode: string;
  target_score: number;
  min_completion_time?: number;
  max_attempts: number;
  deadline?: string;
  assigned_at: string;
  status: string;
  started_at?: string;
  completed_at?: string;
  attempts_count: number;
  best_score: number;
  total_time_spent: number;
  teacher_name: string;
}

export interface SubmitHomeworkAttemptRequest {
  score: number;
  time_spent: number;
  correct_count: number;
  wrong_count: number;
  total_words: number;
  details?: string;
}

export interface HomeworkAttemptResponse {
  id: number;
  attempt_number: number;
  score: number;
  time_spent: number;
  correct_count: number;
  wrong_count: number;
  total_words: number;
  completed_at: string;
}

// ========================================
// 教师端API
// ========================================

export const createHomework = async (
  request: CreateHomeworkRequest
): Promise<{ message: string; homework_id: number; assigned_count: number; skipped_count: number; total: number }> => {
  const response = await axios.post(`${API_BASE_URL}/teacher/homework`, request);
  return response.data;
};

export const getTeacherHomework = async (): Promise<HomeworkResponse[]> => {
  const response = await axios.get(`${API_BASE_URL}/teacher/homework`);
  return response.data;
};

export const getHomeworkStudentStatus = async (homeworkId: number): Promise<StudentHomeworkStatusResponse[]> => {
  const response = await axios.get(`${API_BASE_URL}/teacher/homework/${homeworkId}/students`);
  return response.data;
};

export const getStudentHomeworkAttempts = async (
  homeworkId: number,
  studentId: number
): Promise<HomeworkAttemptResponse[]> => {
  const response = await axios.get(`${API_BASE_URL}/teacher/homework/${homeworkId}/student/${studentId}/attempts`);
  return response.data;
};

export const deleteHomework = async (homeworkId: number): Promise<void> => {
  await axios.delete(`${API_BASE_URL}/teacher/homework/${homeworkId}`);
};

// ========================================
// 学生端API
// ========================================

export const getMyHomework = async (status?: string): Promise<StudentHomeworkResponse[]> => {
  const params = status ? { status } : {};
  const response = await axios.get(`${API_BASE_URL}/student/my-homework`, { params });
  return response.data;
};

export const startHomework = async (
  assignmentId: number
): Promise<{ message: string; unit_id: number; learning_mode: string }> => {
  const response = await axios.post(`${API_BASE_URL}/student/homework/${assignmentId}/start`);
  return response.data;
};

export const submitHomeworkAttempt = async (
  assignmentId: number,
  request: SubmitHomeworkAttemptRequest
): Promise<{
  message: string;
  is_passed: boolean;
  score: number;
  best_score: number;
  attempts_count: number;
  remaining_attempts: number;
}> => {
  const response = await axios.post(`${API_BASE_URL}/student/homework/${assignmentId}/submit`, request);
  return response.data;
};

export const getMyHomeworkAttempts = async (assignmentId: number): Promise<HomeworkAttemptResponse[]> => {
  const response = await axios.get(`${API_BASE_URL}/student/homework/${assignmentId}/attempts`);
  return response.data;
};
