/**
 * 地推体验卡 + 销售跟单 API —— 规则真源在后端 services/promo.py
 *
 * 落地页两个接口是公开的(扫卡的家长没有账号),走裸 axios 不带 token;
 * 其余走 client(销售只看自己的线索,机构管理员看全机构)
 */
import axios from 'axios';
import client from './client';
import { API_BASE_URL } from '../config/env';

export type PromoStatus = 'new' | 'contacted' | 'paid' | 'opened' | 'won' | 'lost';

/** 状态的展示顺序与文案(列表、筛选、看板共用一份,与后端 STATUS_LABELS 同值) */
export const PROMO_STATUSES: Array<{ key: PromoStatus; label: string }> = [
  { key: 'new', label: '待联系' },
  { key: 'contacted', label: '已加微信' },
  { key: 'paid', label: '已付体验费' },
  { key: 'opened', label: '已开通' },
  { key: 'won', label: '已报正价' },
  { key: 'lost', label: '无效' },
];

export interface PublicCard {
  org_name: string;
  org_logo: string;
  trial_price: number;
  offer_text: string;
  grades: string[];
}

export interface CardSubmitResult {
  status: 'created' | 'duplicate';
  sales_name: string;
  qr_image_url: string;
  wechat_hint: string;
}

export interface SalesProfile {
  qr_image_url: string;
  qr_kind: 'wechat' | 'group';
  wechat_hint: string;
  qr_updated_at: string | null;
  qr_stale: boolean;
}

export interface CardDesign {
  template_id: string;
  /** 卡上印的名字(没自定义过 = 销售姓名) */
  display_name: string;
  /** 卡上印的电话(没自定义过 = 销售账号手机号;空串 = 不印) */
  display_phone: string;
}

export interface Paged<T> { items: T[]; total: number; page: number; size: number }

export interface PromoChannel {
  id: number;
  code: string;
  name: string;
  path: string;
  is_active: boolean;
  view_count: number;
  design: CardDesign;
  sales_user_id?: number | null;
  sales_name?: string;
  leads?: number;
  created_at?: string | null;
}

export interface PromoSettings { trial_price: number; offer_text: string }

export interface MyPromo {
  name: string;
  role: string;
  profile: SalesProfile;
  channels: PromoChannel[];
  settings: PromoSettings;
}

export interface PromoLead {
  id: number;
  parent_phone: string;
  parent_name: string;
  child_grade: string;
  existing_account: boolean;
  status: PromoStatus;
  status_label: string;
  note: string;
  next_follow_at: string | null;
  overdue: boolean;
  paid_amount: number | null;
  sales_user_id: number | null;
  sales_name: string;
  channel_id: number | null;
  channel_name: string;
  channel_code: string;
  student_id: number | null;
  student_name: string;
  /** 开通后 7 天里实际学了几天(study_calendar);没开通/没关联学生号为 null */
  studied_days: number | null;
  created_at: string | null;
  contacted_at: string | null;
  paid_at: string | null;
  opened_at: string | null;
  won_at: string | null;
}

export interface PromoLeadList {
  items: PromoLead[];
  total: number;
  page: number;
  size: number;
  counts: Record<PromoStatus, number>;
  overdue: number;
  is_manager: boolean;
}

export interface FollowUp {
  id: number;
  content: string;
  status_after: PromoStatus | null;
  status_label: string;
  created_by_name: string;
  created_at: string | null;
}

export interface SalesAccount {
  id: number;
  username: string;
  full_name: string;
  phone: string;
  is_active: boolean;
  profile: SalesProfile;
  created_at: string | null;
  /** 名下几版卡 / 几条线索(删之前要不要选接手人) */
  channels: number;
  leads: number;
}

export interface BoardRow {
  sales_user_id: number | null;
  name: string;
  is_active: boolean;
  channels: number;
  views: number;
  leads: number;
  contacted: number;
  paid: number;
  opened: number;
  studied: number;
  won: number;
  lost: number;
  revenue: number;
  overdue: number;
}

export interface PromoBoard { items: BoardRow[]; total: BoardRow; study_days_target: number }

// ---------------- 公开(落地页) ----------------

export const getPublicCard = async (code: string): Promise<PublicCard> =>
  (await axios.get(`${API_BASE_URL}/promo/public/${encodeURIComponent(code)}`)).data;

export const submitCardLead = async (code: string, data: {
  parent_phone: string; parent_name?: string; child_grade?: string;
}): Promise<CardSubmitResult> =>
  (await axios.post(`${API_BASE_URL}/promo/public/${encodeURIComponent(code)}/leads`, data)).data;

// ---------------- 销售自己 ----------------

export const getMyPromo = (): Promise<MyPromo> => client.get('/promo/me');

export const updateMyPromo = (data: { wechat_hint?: string; qr_kind?: 'wechat' | 'group' }): Promise<SalesProfile> =>
  client.put('/promo/me', data);

export const uploadMyQr = (file: File, kind: 'wechat' | 'group'): Promise<SalesProfile> => {
  const form = new FormData();
  form.append('file', file);
  return client.post(`/promo/me/qr?qr_kind=${kind}`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
};

// ---------------- 跟单 ----------------

export const listPromoLeads = (params: {
  status?: PromoStatus | ''; owner?: number | null; overdue?: boolean; search?: string; page?: number; size?: number;
}): Promise<PromoLeadList> =>
  client.get('/promo/leads', {
    params: {
      status: params.status || undefined,
      owner: params.owner ?? undefined,
      overdue: params.overdue || undefined,
      search: params.search || undefined,
      page: params.page || 1,
      size: params.size || 20,
    },
  });

export const updatePromoLead = (id: number, data: {
  status?: PromoStatus; note?: string; next_follow_at?: string; paid_amount?: number | null;
  student_ref?: string; sales_user_id?: number | null;
}): Promise<PromoLead> => client.patch(`/promo/leads/${id}`, data);

export const listFollowUps = (id: number): Promise<FollowUp[]> => client.get(`/promo/leads/${id}/follow-ups`);

export const addFollowUp = (id: number, data: { content: string; status?: PromoStatus; next_follow_at?: string }): Promise<FollowUp[]> =>
  client.post(`/promo/leads/${id}/follow-ups`, data);

// ---------------- 机构管理员 ----------------

export const listSales = (params: { page?: number; size?: number; search?: string; status?: 'active' | 'inactive' | '' } = {}):
  Promise<Paged<SalesAccount>> =>
  client.get('/promo/sales', {
    params: { page: params.page || 1, size: params.size || 20, search: params.search || undefined, status: params.status || undefined },
  });

/** 下拉框用: 在用的全部销售,不分页 */
export const listActiveSales = (): Promise<Paged<SalesAccount>> => client.get('/promo/sales', { params: { all: true } });

export const createSales = (data: { username: string; full_name: string; phone?: string; password?: string }):
  Promise<{ id: number; username: string; full_name: string; initial_password: string }> =>
  client.post('/promo/sales', data);

export const updateSales = (id: number, data: { full_name?: string; username?: string; phone?: string; is_active?: boolean }) =>
  client.patch(`/promo/sales/${id}`, data);

/** 名下有卡或线索要带接手人;不带时后端回 409 detail.code=TRANSFER_REQUIRED */
export const deleteSales = (id: number, transferTo?: number | null): Promise<{ moved_channels: number; moved_leads: number }> =>
  client.delete(`/promo/sales/${id}`, { params: { transfer_to: transferTo ?? undefined } });

export const resetSalesPassword = (id: number): Promise<{ username: string; password: string }> =>
  client.post(`/promo/sales/${id}/reset-password`);

export const listChannels = (params: { page?: number; size?: number; owner?: number | null; search?: string } = {}):
  Promise<Paged<PromoChannel>> =>
  client.get('/promo/channels', {
    params: { page: params.page || 1, size: params.size || 20, owner: params.owner ?? undefined, search: params.search || undefined },
  });

export const createChannel = (data: { name?: string; sales_user_id: number; template_id?: string }): Promise<PromoChannel> =>
  client.post('/promo/channels', data);

/** 改卡面(销售改自己的、管理员改全机构的)。display_name 空串 = 跟销售姓名;display_phone 空串 = 不印电话 */
export const updateCardDesign = (id: number, data: Partial<CardDesign>): Promise<PromoChannel> =>
  client.put(`/promo/channels/${id}/design`, data);

export const updateChannel = (id: number, data: { name?: string; sales_user_id?: number; is_active?: boolean }): Promise<PromoChannel> =>
  client.patch(`/promo/channels/${id}`, data);

export const getPromoBoard = (params: { start?: string; end?: string }): Promise<PromoBoard> =>
  client.get('/promo/board', { params });

export const getPromoSettings = (): Promise<PromoSettings> => client.get('/promo/settings');

export const savePromoSettings = (data: { trial_price?: number | null; offer_text?: string }): Promise<PromoSettings> =>
  client.put('/promo/settings', data);

/**
 * 卡上二维码指向的地址。**印出去就改不了**,所以不能用当前地址栏的域名:
 * 管理员常走 IP:3000 那个入口,印成 IP 的码换了服务器就全废。生产固定用正式域名
 */
export const PROMO_PUBLIC_ORIGIN = 'https://es.feiyingsteam.com';

export function cardUrl(code: string): string {
  const h = window.location.hostname;
  const isLocalDev = h === 'localhost' || h === '127.0.0.1';
  return `${isLocalDev ? window.location.origin : PROMO_PUBLIC_ORIGIN}/c/${code}`;
}
