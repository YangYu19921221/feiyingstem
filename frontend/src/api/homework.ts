import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import './_axiosBootstrap';
import { submitReliably } from './submitQueue';

// ========================================
// 类型定义
// ========================================

export interface CreateHomeworkRequest {
  title: string;
  description?: string;
  unit_id: number;
  group_index?: number | null;
  // 分组多选(仅单单元时有效):一次为每个组各建一份作业(优先于 group_index,标题自动带组号)
  group_indexes?: number[];
  learning_mode: string; // flashcard, spelling, fillblank, quiz
  student_ids: number[];
  target_score: number;
  min_completion_time?: number;
  max_attempts: number;
  deadline?: string;
  // 单元多选:一次为多个单元各建一份作业(优先于 unit_id;多选时忽略分组)
  unit_ids?: number[];
  // 当日任务:开始日期(YYYY-MM-DD),当天0点开放、当天24点截止,只能当天完成;
  // 空=普通作业(立即布置,可自设截止时间)。设了日期后 deadline 会被后端忽略
  available_date?: string;
  // 多单元/多组 + 开始日期时:每份作业比前一份顺延一天(一次布置未来一周)
  daily_sequence?: boolean;
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
  /** 当日任务的开放日期(YYYY-MM-DD,北京日,当天24点截止);空=普通作业 */
  available_from?: string;
  created_at: string;
  total_assigned: number;
  completed_count: number;
  in_progress_count: number;
  pending_count: number;
  is_closed?: boolean;
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
  /** 未到开放日的当日任务:列表可见但不能做,点了只提示 */
  is_locked?: boolean;
  /** 当日任务的开放时刻(北京墙上时间);普通作业为 null */
  available_from?: string | null;
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
): Promise<{ message: string; homework_id: number; homework_ids?: number[]; assigned_count: number; skipped_count: number; total: number }> => {
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

/** 关闭/重新开放作业:关闭=学生端隐藏、不能再交卷,做题记录保留 */
export const toggleHomeworkClosed = async (
  homeworkId: number
): Promise<{ homework_id: number; is_closed: boolean; message: string }> => {
  const response = await axios.post(`${API_BASE_URL}/teacher/homework/${homeworkId}/toggle-closed`);
  return response.data;
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

// 交卷走可靠提交队列:断网/重启窗口先落本地稍后自动补交,
// 幂等键保证一次成绩只烧一次尝试机会(不会重复扣次数)
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
  /** 本次达标刚好把当天任务全做完,系统自动发了金币(手动模式恒为 false) */
  coin_awarded?: boolean;
  /** 达标却没发币时的原因(补做/已发过/还差几份/手动模式),没有疑问场景时为 null */
  coin_hint?: { code: string; message: string } | null;
}> => {
  return submitReliably(`/student/homework/${assignmentId}/submit`, request);
};

export const getMyHomeworkAttempts = async (assignmentId: number): Promise<HomeworkAttemptResponse[]> => {
  const response = await axios.get(`${API_BASE_URL}/student/homework/${assignmentId}/attempts`);
  return response.data;
};
