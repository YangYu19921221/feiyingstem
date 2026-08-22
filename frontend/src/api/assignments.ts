import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import './_axiosBootstrap';

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
  student_name: string | null;
  teacher_id: number;
  /** 开书人姓名与角色。teacher_id 存的是操作人,管理员开的书就是管理员 */
  assigner_name?: string | null;
  assigner_role?: string | null;
  scope_type: string;
  unit_id: number | null;
  group_index: number | null;
  unit_name?: string | null;
  unit_number?: number | null;
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
  /** 开书人角色:管理员开的书 teacher_name 是管理员姓名,前端据此换文案 */
  assigner_role?: string | null;
  assigned_at: string;
  deadline?: string;
  is_completed: boolean;
  progress_percentage: number;
  unit_count: number;
  word_count: number;
  // 分配范围:book=整本 / unit=单元 / group=单元内分组
  scope_type: 'book' | 'unit' | 'group';
  unit_id?: number | null;
  unit_name?: string | null;
  unit_number?: number | null;
  group_index?: number | null;
  // 兑换卡状态
  grant_type?: 'permanent' | 'period' | 'times';
  active?: boolean;
  expires_at?: string | null;
  times_left?: number | null;
  days_left?: number | null;
  used_today?: boolean | null;
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

/** 某学生已开通的全部书本(不限分配教师,查"他能学什么"的全量口径) */
export const getStudentAssignments = async (studentId: number): Promise<BookAssignmentResponse[]> => {
  const response = await axios.get(`${API_BASE_URL}/teacher/students/${studentId}/assignments`);
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
