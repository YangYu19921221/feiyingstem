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
  logo_url?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  status: 'active' | 'suspended' | 'expired';
  expires_at?: string | null;
  created_at?: string;
}

export type OrgInfo = Omit<Organization, 'created_at'>;

export interface OrgTeacher {
  id: number;
  username: string;
  full_name?: string | null;
  phone?: string | null;
  is_active: boolean;
  last_login?: string | null;
  created_at?: string;
}

/** 机构管理员账号(与 OrgTeacher 同构,少一个 created_at) */
export type OrgManager = Omit<OrgTeacher, 'created_at'>;

// ---------- 平台管理端(admin) ----------
export const adminOrgApi = {
  list: () => client.get<Organization[]>('/admin/organizations'),
  create: (data: { name: string; code?: string; plan?: string; student_quota?: number; contact_name?: string; contact_phone?: string }) =>
    client.post<Organization>('/admin/organizations', data),
  update: (orgId: number, data: Partial<{ name: string; plan: string; student_quota: number; status: string; contact_name: string; contact_phone: string; expires_at: string; clear_expires: boolean }>) =>
    client.patch<Organization>(`/admin/organizations/${orgId}`, data),
  createOrgAdmin: (orgId: number, data: { username: string; password?: string; full_name?: string; phone?: string }) =>
    // 路径避开 */admins: Safari 内容拦截器会按关键词掐掉该 XHR
    client.post<{ id: number; username: string; initial_password: string; org_code: string }>(`/admin/organizations/${orgId}/managers`, data),
  listOrgAdmins: (orgId: number) =>
    client.get<OrgManager[]>(`/admin/organizations/${orgId}/managers`),
  // 复用通用用户接口: 重置密码(不传密码=服务端生成防混淆字符的新密码,响应返回一次)与停用/恢复
  resetUserPassword: (userId: number) =>
    client.post<{ message: string; new_password: string | null }>(`/admin/users/${userId}/reset-password`, {}),
  toggleUserStatus: (userId: number) =>
    client.post<{ is_active: boolean }>(`/admin/users/${userId}/toggle-status`),
};

// ---------- 机构管理端(org_admin) ----------
export const orgAdminApi = {
  info: () => client.get<OrgInfo>('/org/info'),
  updateInfo: (data: Partial<{ name: string; contact_name: string; contact_phone: string }>) =>
    client.patch<{ updated: boolean; name: string }>('/org/info', data),
  uploadLogo: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return client.post<{ logo_url: string }>('/org/logo', form);
  },
  teachers: () => client.get<OrgTeacher[]>('/org/teachers'),
  createTeacher: (data: { username: string; password?: string; full_name?: string; phone?: string }) =>
    client.post<{ id: number; username: string; initial_password: string }>('/org/teachers', data),
  toggleTeacher: (teacherId: number) =>
    client.patch<{ id: number; is_active: boolean }>(`/org/teachers/${teacherId}/toggle-active`),
};
