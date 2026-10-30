/** 电教室网络设置(2026-10-30)。后端 backend/app/api/v1/classroom_net.py,规则真源 services/classroom_net.py */
import api from './client';

export interface ClassroomDeviceIp {
  ip: string;
  first_seen_at: string | null;
  last_seen_at: string | null;
  /** 还在 7 天内 = 现在算电教室 */
  counts: boolean;
  /** 最近 2 天第一次出现(孩子把设备码抄回家时这里会冒出家里的 IP) */
  new: boolean;
}

export interface ClassroomDevice {
  id: number;
  name: string;
  created_by_name: string | null;
  created_at: string | null;
  last_seen_at: string | null;
  last_ip: string | null;
  ips: ClassroomDeviceIp[];
}

export interface ClassroomNetSettings {
  mode: 'any' | 'classroom';
  can_switch: boolean;
  keep_days: number;
  my_ip: string | null;
  ip_is_classroom: boolean;
  this_device: { id: number; name: string } | null;
  classroom_ips: { ip: string; sources: string[] }[];
  devices: ClassroomDevice[];
  temp_nets: { id: number; ip: string; created_by_name: string | null; created_at: string | null }[];
  home_allow_count: number;
}

export interface HomeAllow {
  until_day: string | null;
  note: string | null;
  created_by_name: string | null;
  active: boolean;
}

export interface ClassroomStudent {
  id: number;
  name: string;
  username: string;
  home_allow: HomeAllow | null;
}

export interface ImpactItem {
  id: number;
  name: string;
  outside_views: number;
  inside_views: number;
  last_outside_at: string | null;
  home_allow: HomeAllow | null;
}

const BASE = '/phonetics/classroom-net';

export const classroomNetApi = {
  get: () => api.get<ClassroomNetSettings>(BASE),
  setMode: (mode: 'any' | 'classroom') => api.put<{ mode: string }>(`${BASE}/mode`, { mode }),
  registerDevice: (name: string) =>
    api.post<{ id: number; name: string; key: string | null }>(`${BASE}/devices`, { name }),
  renameDevice: (id: number, name: string) => api.patch(`${BASE}/devices/${id}`, { name }),
  removeDevice: (id: number) => api.delete(`${BASE}/devices/${id}`),
  ping: () => api.post<{ ok: boolean; name: string }>(`${BASE}/ping`),
  addTempNet: () => api.post<{ ip: string }>(`${BASE}/temp-net`),
  removeTempNet: (id: number) => api.delete(`${BASE}/temp-net/${id}`),
  students: (q?: string) =>
    api.get<{ items: ClassroomStudent[]; limited: boolean }>(`${BASE}/students`, { params: q ? { q } : {} }),
  setHomeAllow: (studentId: number, body: { until_day?: string | null; note?: string | null }) =>
    api.put(`${BASE}/home-allows/${studentId}`, body),
  removeHomeAllow: (studentId: number) => api.delete(`${BASE}/home-allows/${studentId}`),
  impact: () => api.get<{ days: number; items: ImpactItem[] }>(`${BASE}/impact`),
};
