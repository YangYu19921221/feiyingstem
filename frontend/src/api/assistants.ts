/** 我的助教 —— 主老师给助教各开一个账号,助教布置的作业/加的金币记在助教本人名下 */
import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import './_axiosBootstrap';

export interface Assistant {
  id: number;
  username: string;
  full_name: string | null;
  is_active: boolean;
  last_login: string | null;
  created_at: string | null;
}

const base = `${API_BASE_URL}/teacher/assistants`;

export const assistantApi = {
  list: async () => (await axios.get<{ items: Assistant[]; max: number }>(base)).data,
  create: async (body: { full_name: string; username: string; password: string }) =>
    (await axios.post<Assistant>(base, body)).data,
  update: async (id: number, body: { full_name?: string; is_active?: boolean }) =>
    (await axios.patch<Assistant>(`${base}/${id}`, body)).data,
  resetPassword: async (id: number, password: string) =>
    (await axios.post(`${base}/${id}/password`, { password })).data,
  remove: async (id: number) => (await axios.delete(`${base}/${id}`)).data,
};
