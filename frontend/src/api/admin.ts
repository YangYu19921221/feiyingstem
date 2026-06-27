import axios from 'axios';
import './_axiosBootstrap';
import { API_BASE_URL } from '../config/env';

export interface AdminTeacherListItem {
  id: number;
  username: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
  last_login: string | null;
  class_count: number;
  student_count: number;
}

export interface AdminClassListItem {
  id: number;
  name: string;
  description: string | null;
  teacher_id: number;
  teacher_username: string;
  student_count: number;
}

export interface AdminTeacherDetail {
  id: number;
  username: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
  classes: { id: number; name: string; description: string | null; created_at: string }[];
}

export interface AdminClassOverview {
  class_id: number;
  name: string;
  student_count: number;
  avg_accuracy: number;
  total_words_studied: number;
  mastered_words: number;
}

// 班级学生名册项
export interface AdminClassStudent {
  id: number;
  username: string;
  full_name: string | null;
  joined_at: string | null;
}

// 学生学习详情(当日+累计+近7天)
export interface AdminStudentDetail {
  user_id: number;
  username: string;
  full_name: string;
  today_words: number;
  today_duration: number;
  today_accuracy: number;
  today_sessions: number;
  total_words_learned: number;
  total_mastered: number;
  total_study_days: number;
  total_study_time: number;
  overall_accuracy: number;
  weak_words_count: number;
  last_active: string | null;
  recent_daily_words: number[];
  recent_daily_dates: string[];
}

// 班级学习统计(柱状图数据源)
export interface AdminMetricTriple {
  training: number;  // 训练量(答题数)
  vocab: number;     // 词汇量(distinct)
  time: number;      // 学习时间(秒)
}
export interface AdminSeriesPoint {
  date: string;
  value: number;
}
export interface AdminClassStatsSummary {
  today: AdminMetricTriple;
  yesterday: AdminMetricTriple;
  last7days: {
    training: AdminSeriesPoint[];
    vocab: AdminSeriesPoint[];
    time: AdminSeriesPoint[];
  };
  total_vocab: number;
}

// 竞赛
export interface AdminCompetitionOverview {
  participants: number;
  total_answers: number;
  avg_accuracy: number;
  active_seasons: number;
}
export interface AdminLeaderboardItem {
  rank: number;
  user_id: number;
  username: string;
  full_name: string;
  score: number;
  questions_answered: number;
  correct_count: number;
  accuracy: number;
  max_combo: number;
}

// 学生已授权书本
export interface AdminStudentBook {
  assignment_id: number;
  book_id: number;
  book_name: string;
  scope_type: string;
  assigned_at: string | null;
}

// 可选单词本(供添加)
export interface AdminWordBookOption {
  id: number;
  name: string;
  grade_level: string | null;
}

// 学生考试成绩(单元 + 小组合并)
export interface AdminStudentExam {
  type: 'unit' | 'group';
  label: string;
  score: number;
  total_score: number;
  accuracy: number;
  correct_count?: number;
  total_questions?: number;
  at: string | null;
}

const BASE = `${API_BASE_URL}/admin`;

export const admin = {
  listTeachers: async (): Promise<AdminTeacherListItem[]> => {
    const r = await axios.get(`${BASE}/teachers`);
    return r.data;
  },

  getTeacher: async (id: number): Promise<AdminTeacherDetail> => {
    const r = await axios.get(`${BASE}/teachers/${id}`);
    return r.data;
  },

  createTeacher: async (
    payload: { username: string; email: string; full_name?: string; password?: string }
  ): Promise<{ id: number; username: string; initial_password: string }> => {
    const r = await axios.post(`${BASE}/teachers`, payload);
    return r.data;
  },

  updateTeacher: async (
    id: number, body: { full_name?: string; is_active?: boolean }
  ) => {
    const r = await axios.patch(`${BASE}/teachers/${id}`, body);
    return r.data;
  },

  resetPassword: async (id: number): Promise<{ new_password: string }> => {
    const r = await axios.post(`${BASE}/teachers/${id}/reset-password`);
    return r.data;
  },

  deleteTeacher: async (id: number): Promise<{ deleted: boolean }> => {
    const r = await axios.delete(`${BASE}/teachers/${id}`);
    return r.data;
  },

  listClasses: async (teacher_id?: number): Promise<AdminClassListItem[]> => {
    const r = await axios.get(`${BASE}/classes`, { params: teacher_id ? { teacher_id } : {} });
    return r.data;
  },

  classOverview: async (id: number): Promise<AdminClassOverview> => {
    const r = await axios.get(`${BASE}/classes/${id}/overview`);
    return r.data;
  },

  transferStudent: async (student_id: number, new_class_id: number) => {
    const r = await axios.post(`${BASE}/students/${student_id}/transfer`, { new_class_id });
    return r.data;
  },

  // 班级学生名册(admin 版,不受教师归属校验)
  classStudents: async (class_id: number, q?: string): Promise<AdminClassStudent[]> => {
    const r = await axios.get(`${BASE}/classes/${class_id}/students`, { params: q ? { q } : {} });
    return r.data;
  },

  // 学生学习详情
  studentDetail: async (student_id: number): Promise<AdminStudentDetail> => {
    const r = await axios.get(`${BASE}/students/${student_id}/detail`);
    return r.data;
  },

  // 班级学习统计(今日/昨日/近7天 各指标 + 词汇总量)
  classStatsSummary: async (class_id: number): Promise<AdminClassStatsSummary> => {
    const r = await axios.get(`${BASE}/classes/${class_id}/stats-summary`);
    return r.data;
  },

  // 竞赛概览
  competitionOverview: async (): Promise<AdminCompetitionOverview> => {
    const r = await axios.get(`${BASE}/competition/overview`);
    return r.data;
  },

  // 竞赛排行榜
  competitionLeaderboard: async (
    board: 'overall' | 'daily' | 'weekly' | 'monthly' = 'overall',
    limit = 50,
  ): Promise<{ board: string; items: AdminLeaderboardItem[] }> => {
    const r = await axios.get(`${BASE}/competition/leaderboard`, { params: { board, limit } });
    return r.data;
  },

  // 学生订阅书本
  studentBooks: async (studentId: number): Promise<AdminStudentBook[]> => {
    const r = await axios.get(`${BASE}/students/${studentId}/books`);
    return r.data;
  },
  addStudentBook: async (studentId: number, bookId: number) => {
    const r = await axios.post(`${BASE}/students/${studentId}/books`, { book_id: bookId });
    return r.data;
  },
  removeStudentBook: async (studentId: number, assignmentId: number) => {
    const r = await axios.delete(`${BASE}/students/${studentId}/books/${assignmentId}`);
    return r.data;
  },

  // 所有单词本(供添加选择,复用内容管理接口)
  listWordBooks: async (): Promise<AdminWordBookOption[]> => {
    const r = await axios.get(`${BASE}/content/word-books`, { params: { page: 1, page_size: 100 } });
    const arr = r.data?.books || [];
    return arr.map((b: any) => ({ id: b.id, name: b.name, grade_level: b.grade_level ?? null }));
  },

  // 学生考试成绩(单元 + 小组)
  studentExams: async (studentId: number): Promise<AdminStudentExam[]> => {
    const r = await axios.get(`${BASE}/students/${studentId}/exams`);
    return r.data;
  },
};
