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
};
