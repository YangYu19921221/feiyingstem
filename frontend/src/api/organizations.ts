/** 多租户: 机构管理 API(平台管理端 + 机构管理端) */
import client from './client';

// ---------- 类型 ----------
export interface Organization {
  id: number;
  name: string;
  code: string;
  plan: string;
  student_quota: number;
  active_students: number;
  teacher_count: number;
  contact_name?: string | null;
  contact_phone?: string | null;
  status: 'active' | 'suspended' | 'expired';
  expires_at?: string | null;
  created_at?: string;
}

export interface OrgInfo {
  id: number;
  name: string;
  code: string;
  plan: string;
  student_quota: number;
  active_students: number;
  teacher_count: number;
  status: string;
  expires_at?: string | null;
}

export interface OrgTeacher {
  id: number;
  username: string;
  full_name?: string | null;
  phone?: string | null;
  is_active: boolean;
  last_login?: string | null;
  created_at?: string;
}

// ---------- 平台管理端(admin) ----------
export const adminOrgApi = {
  list: () => client.get<Organization[]>('/admin/organizations').then(r => r.data),
  create: (data: { name: string; code?: string; plan?: string; student_quota?: number; contact_name?: string; contact_phone?: string }) =>
    client.post<Organization>('/admin/organizations', data).then(r => r.data),
  update: (orgId: number, data: Partial<{ name: string; plan: string; student_quota: number; status: string; contact_name: string; contact_phone: string; expires_at: string }>) =>
    client.patch<Organization>(`/admin/organizations/${orgId}`, data).then(r => r.data),
  createOrgAdmin: (orgId: number, data: { username: string; password?: string; full_name?: string; phone?: string }) =>
    client.post<{ id: number; username: string; initial_password: string; org_code: string }>(`/admin/organizations/${orgId}/admins`, data).then(r => r.data),
  listOrgAdmins: (orgId: number) =>
    client.get(`/admin/organizations/${orgId}/admins`).then(r => r.data),
};

// ---------- 机构管理端(org_admin) ----------
export const orgAdminApi = {
  info: () => client.get<OrgInfo>('/org/info').then(r => r.data),
  teachers: () => client.get<OrgTeacher[]>('/org/teachers').then(r => r.data),
  createTeacher: (data: { username: string; password?: string; full_name?: string; phone?: string }) =>
    client.post<{ id: number; username: string; initial_password: string }>('/org/teachers', data).then(r => r.data),
  toggleTeacher: (teacherId: number) =>
    client.patch<{ id: number; is_active: boolean }>(`/org/teachers/${teacherId}/toggle-active`).then(r => r.data),
};
