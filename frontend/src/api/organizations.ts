/** 多租户: 机构管理 API(平台管理端 + 机构管理端) */
import client from './client';

// ---------- 类型 ----------
export interface Organization {
  id: number;
  name: string;
  code: string;
  plan: string;
  student_quota: number;
  /** 学习卡额度(按张卖的半年卡)。与 student_quota 是两笔账:
   *  student_quota = 同时在读人数(学生离班可复用),card_quota = 买过多少张卡(一次性消耗)。
   *  card_quota_explicit=false 表示机构没单独设过、当前跟随学生名额 */
  card_quota: number;
  card_quota_explicit?: boolean;
  cards_used: number;
  cards_left: number;
  active_students: number;
  teacher_count: number;
  logo_url?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  status: 'active' | 'suspended' | 'expired';
  expires_at?: string | null;
  // 内容授权模式: assigned=逐本分配(默认) | all_books=全托(时间+人数付费,书本全开放)
  access_mode?: 'assigned' | 'all_books';
  // 金币发放: auto=系统按规则自动发(默认) | manual=只能老师核实后手动加
  coin_mode?: 'auto' | 'manual';
  // 区域保护(协议第四条): 经营场所与独家半径。lat/lng 为空=未登记,不参与判定也不受保护
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  protect_radius_km?: number | null;
  /** force 放行时回传被跳过的冲突(仅创建/更新响应带) */
  territory_overridden?: TerritoryConflict[];
  created_at?: string;
}

/** 区域冲突明细(3 公里内已有合作点) */
export interface TerritoryConflict {
  org_id: number;
  org_name: string;
  org_code: string;
  status: string;
  plan: string;
  address?: string | null;
  distance_km: number;
  threshold_km: number;
}

/** 409 区域冲突响应体(detail 字段) */
export interface TerritoryConflictDetail {
  code: 'TERRITORY_CONFLICT';
  message: string;
  radius_km: number;
  conflicts: TerritoryConflict[];
}

export interface TerritoryCheckResult {
  ok: boolean;
  radius_km: number;
  conflicts: TerritoryConflict[];
  nearby: { org_id: number; org_name: string; org_code: string; plan: string; status: string; distance_km: number }[];
  /** 没登记坐标因而判不了的机构数——「零冲突」要连它一起读 */
  unmapped_orgs: number;
}

/** 从 axios 错误里取出区域冲突明细;不是这种错误则返回 null */
export function territoryConflictOf(e: unknown): TerritoryConflictDetail | null {
  const detail = (e as { response?: { status?: number; data?: { detail?: unknown } } })?.response?.data?.detail;
  if (detail && typeof detail === 'object' && (detail as TerritoryConflictDetail).code === 'TERRITORY_CONFLICT') {
    return detail as TerritoryConflictDetail;
  }
  return null;
}

export type OrgInfo = Omit<Organization, 'created_at' | 'territory_overridden'>;

export interface OrgTeacher {
  id: number;
  username: string;
  full_name?: string | null;
  phone?: string | null;
  is_active: boolean;
  last_login?: string | null;
  created_at?: string;
  /** 名下班级数 / 去重学生数:停用或删除前让机构看清影响面 */
  class_count?: number;
  student_count?: number;
}

/** 机构管理员账号(与 OrgTeacher 同构,少一个 created_at) */
export type OrgManager = Omit<OrgTeacher, 'created_at'>;

/** 一键开体验账号的结果:三端账号共用一个密码,仅返回这一次 */
export interface TrialProvisionResult {
  org: Organization;
  password: string;
  days: number;
  expires_on: string;
  books_assigned: number;
  accounts: { role: string; label: string; username: string }[];
}

// ---------- 平台管理端(admin) ----------
export const adminOrgApi = {
  list: () => client.get<Organization[]>('/admin/organizations'),
  create: (data: { name: string; code?: string; plan?: string; student_quota?: number; card_quota?: number; contact_name?: string; contact_phone?: string; address?: string; lat?: number; lng?: number; protect_radius_km?: number; force?: boolean }) =>
    client.post<Organization>('/admin/organizations', data),
  update: (orgId: number, data: Partial<{ name: string; plan: string; student_quota: number; card_quota: number; add_cards: number; status: string; contact_name: string; contact_phone: string; expires_at: string; clear_expires: boolean; access_mode: 'assigned' | 'all_books'; coin_mode: 'auto' | 'manual'; address: string; lat: number; lng: number; protect_radius_km: number; force: boolean }>) =>
    client.patch<Organization>(`/admin/organizations/${orgId}`, data),
  /** 区域保护预检: 填完坐标先看周边有没有冲突(只读,谈单时也能查) */
  territoryCheck: (params: { lat: number; lng: number; radius_km?: number; exclude_org_id?: number }) =>
    client.get<TerritoryCheckResult>('/admin/organizations/territory-check', { params }),
  createOrgAdmin: (orgId: number, data: { username: string; password?: string; full_name?: string; phone?: string }) =>
    // 路径避开 */admins: Safari 内容拦截器会按关键词掐掉该 XHR
    client.post<{ id: number; username: string; initial_password: string; org_code: string }>(`/admin/organizations/${orgId}/managers`, data),
  /** 一键开体验账号: 建机构+三端账号+默认班+全部平台词书 */
  provisionTrial: (data: { name?: string; days?: number; student_quota?: number; prefix?: string; password?: string; contact_name?: string; contact_phone?: string }) =>
    client.post<TrialProvisionResult>('/admin/trial-provision', data),
  /** 硬删机构(不可恢复): 需回传机构码二次确认;正式机构须先停用,体验机构可直接删 */
  deleteOrg: (orgId: number, code: string) =>
    client.delete<{ deleted: boolean; org_name: string; users_removed: number }>(`/admin/organizations/${orgId}`, { params: { code } }),
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
  teachers: (q?: string) =>
    client.get<OrgTeacher[]>('/org/teachers', { params: q ? { q } : undefined }),
  createTeacher: (data: { username: string; password?: string; full_name?: string; phone?: string }) =>
    client.post<{ id: number; username: string; initial_password: string }>('/org/teachers', data),
  // 改资料: 用户名是登录凭据不在这里改;phone 传空串 = 清空(后端显式区分 undefined/'')
  updateTeacher: (teacherId: number, data: { full_name?: string; phone?: string }) =>
    client.patch<OrgTeacher>(`/org/teachers/${teacherId}`, data),
  // 重置老师密码: 不传 new_password = 服务端生成并回显一次
  resetTeacherPassword: (teacherId: number, newPassword?: string) =>
    client.post<{ id: number; username: string; new_password: string | null }>(
      `/org/teachers/${teacherId}/reset-password`,
      newPassword ? { new_password: newPassword } : {}),
  toggleTeacher: (teacherId: number) =>
    client.patch<{ id: number; is_active: boolean }>(`/org/teachers/${teacherId}/toggle-active`),
  // 删除前预检:名下班级/学生/授权/作业各多少(与 DELETE 共用同一份后端判定)
  teacherDependents: (teacherId: number) =>
    client.get<{
      id: number; username: string; full_name: string | null;
      dependents: { classes: number; students: number; book_assignments: number; homework: number };
      deletable: boolean;
    }>(`/org/teachers/${teacherId}/dependents`),
  deleteTeacher: (teacherId: number) =>
    client.delete<{ deleted: boolean; id: number }>(`/org/teachers/${teacherId}`),
  // 机构管理员改自己的密码(需旧密码)
  changeMyPassword: (data: { old_password: string; new_password: string }) =>
    client.put<{ updated: boolean }>('/org/my-password', data),
};
