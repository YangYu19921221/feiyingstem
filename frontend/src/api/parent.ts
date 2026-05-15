import client from './client';
import axios from 'axios';
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
