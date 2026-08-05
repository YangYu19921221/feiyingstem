/** 平台管理端 - 加盟意向线索 API */
import client from './client';

// ---------- 类型 ----------

export type LeadStatus =
  | 'new' | 'contacted' | 'materials_sent' | 'negotiating' | 'visited' | 'signed' | 'lost';
export type LeadChannel =
  | 'phone' | 'wechat' | 'website' | 'referral' | 'douyin' | 'exhibition' | 'other';
export type IntentLevel = 'high' | 'medium' | 'low';
export type FollowMethod = 'phone' | 'wechat' | 'meeting' | 'visit' | 'other';

export interface FranchiseLead {
  id: number;
  name: string;
  phone?: string | null;
  wechat?: string | null;
  email?: string | null;
  province?: string | null;
  city?: string | null;
  channel?: LeadChannel | null;
  intent_level?: IntentLevel | null;
  budget?: string | null;
  background?: string | null;
  has_location?: boolean | null;
  expected_launch?: string | null;
  status: LeadStatus;
  lost_reason?: string | null;
  owner_name?: string | null;
  next_follow_at?: string | null;
  signed_at?: string | null;
  org_id?: number | null;
  org_name?: string | null;
  notes?: string | null;
  last_follow?: string | null;
  follow_count: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface LeadFollowUp {
  id: number;
  method?: FollowMethod | null;
  content: string;
  status_after?: LeadStatus | null;
  created_by_name?: string | null;
  created_at?: string | null;
}

export interface LeadDetail extends FranchiseLead {
  follow_ups: LeadFollowUp[];
}

export interface LeadListResult {
  total: number;
  page: number;
  page_size: number;
  items: FranchiseLead[];
}

export interface LeadStats {
  total: number;
  month_new: number;
  pending_follow: number;
  signed: number;
  by_status: Partial<Record<LeadStatus, number>>;
  by_channel: Partial<Record<LeadChannel, number>>;
}

export interface LeadFilters {
  status?: string;
  channel?: string;
  intent_level?: string;
  keyword?: string;
  date_from?: string;
  date_to?: string;
  /** today=今日待跟进(含逾期) / overdue=仅逾期 */
  follow?: string;
}

export interface LeadFormData {
  name: string;
  phone?: string;
  wechat?: string;
  email?: string;
  province?: string;
  city?: string;
  channel?: string;
  intent_level?: string;
  budget?: string;
  background?: string;
  has_location?: boolean | null;
  expected_launch?: string;
  status?: string;
  lost_reason?: string;
  owner_name?: string;
  next_follow_at?: string | null;
  clear_next_follow?: boolean;
  org_id?: number | null;
  notes?: string;
}

// ---------- 中文映射(表格/徽章/导出共用) ----------

export const STATUS_LABELS: Record<LeadStatus, string> = {
  new: '新咨询', contacted: '已联系', materials_sent: '已发资料',
  negotiating: '洽谈中', visited: '已考察', signed: '已签约', lost: '已流失',
};

export const CHANNEL_LABELS: Record<LeadChannel, string> = {
  phone: '电话咨询', wechat: '微信咨询', website: '官网表单', referral: '朋友介绍',
  douyin: '抖音', exhibition: '展会活动', other: '其他',
};

export const INTENT_LABELS: Record<IntentLevel, string> = {
  high: '高意向', medium: '中意向', low: '低意向',
};

export const METHOD_LABELS: Record<FollowMethod, string> = {
  phone: '电话', wechat: '微信', meeting: '面谈', visit: '实地考察', other: '其他',
};

// ---------- API ----------

const clean = (f: LeadFilters) =>
  Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== '')) as Record<string, string>;

export const franchiseLeadApi = {
  stats: () => client.get<LeadStats>('/admin/franchise-leads/stats'),

  list: (filters: LeadFilters, page = 1, pageSize = 20) =>
    client.get<LeadListResult>('/admin/franchise-leads', {
      params: { ...clean(filters), page, page_size: pageSize },
    }),

  /** 按当前筛选导出全量(不分页);前端 xlsx 生成 Excel 下载 */
  exportAll: (filters: LeadFilters) =>
    client.get<FranchiseLead[]>('/admin/franchise-leads/export', { params: clean(filters) }),

  detail: (id: number) => client.get<LeadDetail>(`/admin/franchise-leads/${id}`),

  create: (data: LeadFormData) => client.post<FranchiseLead>('/admin/franchise-leads', data),

  update: (id: number, data: Partial<LeadFormData>) =>
    client.patch<FranchiseLead>(`/admin/franchise-leads/${id}`, data),

  remove: (id: number) => client.delete<void>(`/admin/franchise-leads/${id}`),

  addFollowUp: (id: number, data: { content: string; method?: string; status?: string; next_follow_at?: string }) =>
    client.post<LeadFollowUp>(`/admin/franchise-leads/${id}/follow-ups`, data),
};
