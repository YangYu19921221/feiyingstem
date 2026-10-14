/**
 * 家长推荐(老带新)API —— 规则真源在后端 services/referral.py
 *
 * 落地页两个接口是公开的(朋友家长没有账号),走裸 axios 不带 token;
 * 其余走 client(带当前登录人的 token,老师/机构管理员/家长各看各的范围)
 */
import axios from 'axios';
import client from './client';
import { API_BASE_URL } from '../config/env';

export interface PublicInvite {
  org_name: string;
  org_logo: string;
  referrer: string;          // 已脱敏:「张同学」
  referrer_words: number;
  friend_offer: string;
}

export interface InviteInfo {
  code: string;
  path: string;              // /invite/XXXX,前端拼 origin
  enabled: boolean;
  org_name: string;
  child_name: string;
  words: number;             // 孩子学会了多少词(海报上那个数)
  friend_offer: string;
  reward_coins: number;
  reward_text: string;
  leads: number;
  enrolled: number;
}

export type LeadStatus = 'new' | 'contacted' | 'trial' | 'enrolled' | 'invalid';

export interface ReferralLeadItem {
  id: number;
  parent_name: string;
  parent_phone: string;
  child_name: string;
  child_grade: string;
  note: string;
  existing_account: boolean;
  status: LeadStatus;
  status_label: string;
  staff_note: string;
  referrer_student_id: number | null;
  referrer_name: string;
  reward_status: 'none' | 'pending' | 'granted';
  reward_status_label: string;
  reward_coins: number;
  reward_text: string;
  enrolled_at: string | null;
  reward_granted_at: string | null;
  created_at: string | null;
}

export interface ReferralSettings {
  enabled: boolean;
  reward_coins: number;
  reward_text: string;
  friend_offer: string;
  max_reward_coins: number;
}

export interface ReferralLeadList {
  items: ReferralLeadItem[];
  counts: Record<LeadStatus, number>;
  total: number;
  pending_rewards: number;
  top_referrers: Array<{ student_id: number; name: string; leads: number; enrolled: number }>;
  settings: ReferralSettings | null;
  can_edit_settings: boolean;
}

/** 状态的展示顺序与按钮文案(列表、筛选共用一份) */
export const LEAD_STATUSES: Array<{ key: LeadStatus; label: string }> = [
  { key: 'new', label: '待联系' },
  { key: 'contacted', label: '已联系' },
  { key: 'trial', label: '已试听' },
  { key: 'enrolled', label: '已报名' },
  { key: 'invalid', label: '无效' },
];

/** 邀请链接的完整地址。用当前域名拼:老师在哪个域名下打开,发出去的就是哪个 */
export const inviteUrl = (path: string) => `${window.location.origin}${path}`;

// ---------------- 公开(落地页) ----------------

export const getPublicInvite = async (code: string): Promise<PublicInvite> => {
  const res = await axios.get(`${API_BASE_URL}/referral/public/${encodeURIComponent(code)}`);
  return res.data;
};

export const submitReferralLead = async (code: string, data: {
  parent_name?: string;
  parent_phone: string;
  child_name?: string;
  child_grade?: string;
  note?: string;
}): Promise<{ status: 'created' | 'duplicate' }> => {
  const res = await axios.post(`${API_BASE_URL}/referral/public/${encodeURIComponent(code)}/leads`, data);
  return res.data;
};

// ---------------- 拿邀请链接 ----------------

export const getParentChildInvite = (studentId: number): Promise<InviteInfo> =>
  client.get(`/parent/children/${studentId}/invite`);

export const getTeacherStudentInvite = (studentId: number): Promise<InviteInfo> =>
  client.get(`/teacher/referral/students/${studentId}/invite`);

// ---------------- 跟进 ----------------

export const listReferralLeads = (params: { status?: LeadStatus | ''; search?: string }): Promise<ReferralLeadList> =>
  client.get('/referral/leads', { params: { status: params.status || undefined, search: params.search || undefined } });

export const updateReferralLead = (id: number, data: { status?: LeadStatus; staff_note?: string }) =>
  client.patch(`/referral/leads/${id}`, data);

export const enrollReferralLead = (id: number, grantReward: boolean): Promise<{ coins: number; reward_text: string }> =>
  client.post(`/referral/leads/${id}/enroll`, { grant_reward: grantReward });

export const markReferralRewardGranted = (id: number) =>
  client.post(`/referral/leads/${id}/reward-granted`);

export const saveReferralSettings = (data: Partial<Omit<ReferralSettings, 'max_reward_coins'>>): Promise<ReferralSettings> =>
  client.put('/referral/settings', data);
