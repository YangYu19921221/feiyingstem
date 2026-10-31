import client from './client';
import type { CameraConsentInfo } from './focusWatch';
import axios from 'axios';
import './_axiosBootstrap';
import { API_BASE_URL } from '../config/env';

export interface BindCodeResponse {
  code: string;
  expires_at: string;
  minutes_left: number;
}

export interface ParentTokenResponse {
  access_token: string;
  token_type: string;
  parent_id: number;
  full_name: string | null;
}

export interface ChildSummary {
  student_id: number;
  username: string;
  full_name: string | null;
  today_minutes: number;
  today_words: number;
  streak_days: number;
}

export interface RankInfo {
  rank: number | null;
  total: number;
  value: number;
}

export interface HeatmapDay {
  date: string;
  minutes: number;
}

export interface WeakWordItem {
  word: string;
  meaning: string | null;
  wrong_count: number;
}

export interface BookProgressItem {
  book_id: number;
  book_name: string;
  progress_percentage: number;
  completed_units: number;
  total_units: number;
}

export interface ChildDashboard {
  student_id: number;
  full_name: string | null;
  username: string;
  today_minutes: number;
  today_words: number;
  streak_days: number;
  review_due_today: number;
  review_done_today: number;
  graduated_words: number;
  total_words_learned: number;
  total_words_mastered: number;
  total_minutes: number;
  this_week_minutes: number;
  last_week_minutes: number;
  this_week_words: number;
  last_week_words: number;
  this_week_accuracy: number;
  last_week_accuracy: number;
  rank_vocabulary: RankInfo;
  rank_diligence: RankInfo;
  rank_accuracy: RankInfo;
  heatmap: HeatmapDay[];
  weak_words: WeakWordItem[];
  books: BookProgressItem[];
  unlocked_achievements: number;
  total_achievements: number;
}

// 学生：生成绑定码
export const generateParentBindCode = async (): Promise<BindCodeResponse> => {
  return client.post('/student/parent-bind-codes');
};

// 家长：注册（无需登录态）
export const parentRegister = async (data: {
  bind_code: string;
  phone: string;
  password: string;
  full_name?: string;
}): Promise<ParentTokenResponse> => {
  const res = await axios.post(`${API_BASE_URL}/parent/register`, data);
  return res.data;
};

// 家长：登录（无需登录态）
export const parentLogin = async (
  phone: string,
  password: string,
): Promise<ParentTokenResponse> => {
  const res = await axios.post(`${API_BASE_URL}/parent/login`, { phone, password });
  return res.data;
};

// ================== 老师：家长绑定 ==================
// 规则真源 backend/app/api/v1/parent.py(链接码 7 天、一次性;只能给本班学生发)

export interface BoundParent {
  link_id: number;
  name: string;
  phone: string;        // 已脱敏 138****5678
  bound_at: string | null;
}

export interface ParentBindingStudent {
  id: number;
  username: string;
  full_name: string;
  class_name: string;
  parents: BoundParent[];
  pending: { code: string; expires_at: string } | null;  // 已发出、还没用掉的链接
  /** 摄像头看在不在: 家长同意了没有(家长端自己点的 / 老师登记的纸质同意书) */
  camera?: CameraConsentInfo | null;
}

export interface TeacherBindCode {
  code: string;
  expires_at: string;
  child_name: string;
  renewed: boolean;
}

export const parentBindingApi = {
  list: (): Promise<{ items: ParentBindingStudent[]; bound: number; total: number }> =>
    client.get('/teacher/parent-binding/students'),
  code: (studentId: number, renew = false): Promise<TeacherBindCode> =>
    client.post(`/teacher/parent-binding/students/${studentId}/code`, null, { params: renew ? { renew: true } : undefined }),
  codes: (studentIds: number[]): Promise<{ items: Array<{ student_id: number; child_name: string; username: string; code: string; expires_at: string }> }> =>
    client.post('/teacher/parent-binding/codes', { student_ids: studentIds }),
  unbind: (linkId: number): Promise<{ ok: boolean }> =>
    client.delete(`/teacher/parent-binding/links/${linkId}`),
  resetPassword: (linkId: number): Promise<{ password: string }> =>
    client.post(`/teacher/parent-binding/links/${linkId}/reset-password`),
};

/** 家长点开就能注册的链接(码已填好) */
export const parentRegisterUrl = (code: string) => `${window.location.origin}/parent/register?code=${encodeURIComponent(code)}`;

// 家长：再绑定一个孩子
export const parentBindAdditional = async (bind_code: string): Promise<ChildSummary> => {
  return client.post('/parent/bind', { bind_code });
};

// 家长：我的孩子列表
export const parentListChildren = async (): Promise<ChildSummary[]> => {
  return client.get('/parent/children');
};

// 家长：单孩看板
export const parentChildDashboard = async (studentId: number): Promise<ChildDashboard> => {
  return client.get(`/parent/children/${studentId}/dashboard`);
};

// ================== AI 学情周报 ==================

export interface WeeklyReport {
  student_id: number;
  week_start: string;
  summary: string;
  highlights: string[];
  focus_areas: string[];
  suggestions: string[];
  stats_snapshot: Record<string, any>;
  generated_at: string | null;
}

// 家长：获取孩子本周周报（命中缓存不重复调 AI）
export const getWeeklyReport = async (studentId: number): Promise<WeeklyReport> => {
  return client.get(`/parent/children/${studentId}/weekly-report`);
};

// 家长：强制重新生成周报
export const regenerateWeeklyReport = async (studentId: number): Promise<WeeklyReport> => {
  return client.post(`/parent/children/${studentId}/weekly-report/regenerate`);
};
