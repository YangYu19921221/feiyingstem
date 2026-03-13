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

export interface AssignBookRequest {
  book_id: number;
  student_ids: number[];
  deadline?: string;
}

export interface BookAssignmentResponse {
  id: number;
  book_id: number;
  book_name: string;
  student_id: number;
  student_name: string;
  teacher_id: number;
  assigned_at: string;
  deadline?: string;
  is_completed: boolean;
}

export interface AssignmentStatsResponse {
  book_id: number;
  book_name: string;
  total_assigned: number;
  completed_count: number;
  in_progress_count: number;
}

export interface StudentBookAssignmentResponse {
  id: number;
  book_id: number;
  book_name: string;
  book_description?: string;
  teacher_name: string;
  assigned_at: string;
  deadline?: string;
  is_completed: boolean;
  progress_percentage: number;
  unit_count: number;
  word_count: number;
}

// ========================================
// 教师端API
// ========================================

export const assignBookToStudents = async (
  request: AssignBookRequest
): Promise<{ message: string; assigned_count: number; skipped_count: number; total: number }> => {
  const response = await axios.post(`${API_BASE_URL}/teacher/assign`, request);
  return response.data;
};

export const getBookAssignments = async (bookId: number): Promise<BookAssignmentResponse[]> => {
  const response = await axios.get(`${API_BASE_URL}/teacher/book/${bookId}/assignments`);
  return response.data;
};

export const getTeacherAssignments = async (): Promise<BookAssignmentResponse[]> => {
  const response = await axios.get(`${API_BASE_URL}/teacher/assignments`);
  return response.data;
};

export const getAssignmentStats = async (): Promise<AssignmentStatsResponse[]> => {
  const response = await axios.get(`${API_BASE_URL}/teacher/stats`);
  return response.data;
};

export const deleteAssignment = async (assignmentId: number): Promise<void> => {
  await axios.delete(`${API_BASE_URL}/teacher/assignments/${assignmentId}`);
};

// ========================================
// 学生端API
// ========================================

export const getMyAssignments = async (): Promise<StudentBookAssignmentResponse[]> => {
  const response = await axios.get(`${API_BASE_URL}/student/my-assignments`);
  return response.data;
};

export const markAssignmentComplete = async (
  assignmentId: number
): Promise<{ message: string; is_completed: boolean }> => {
  const response = await axios.post(`${API_BASE_URL}/student/assignments/${assignmentId}/complete`);
  return response.data;
};
