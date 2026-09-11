import api from './client';

/** 学段档位的 key(2026-09-11 学段改成真字段后)。
 *
 * 取值三类,**不要再写成固定联合类型** —— 机构能自建学段(大学/成人/…):
 *   'primary' | 'junior' | 'senior'  平台预置档的 code
 *   'custom:{id}'                    机构自建档
 *   'unassigned'                     未分类(没设学段的书,仍可正常发码)
 * 老码上留痕的 'other' 也仍会出现在历史数据里。
 * 显示名一律用后端下发的 label,别在前端按 key 猜中文名。 */
export type BookStage = string;

export interface BookGroupBook {
  id: number;
  name: string;
  grade_level: string | null;
}

export interface BookGroupStage {
  stage: BookStage;
  label: string;       // 小学 / 初中 / 高中 / 其他
  count: number;
  books: BookGroupBook[];
}

export interface BookGroup {
  series: string;        // 分组原值,'' = 未分组
  series_label: string;  // 显示用(空串显示成「未分组」)
  total: number;
  stages: BookGroupStage[];
}

// 兑换码激活（兑换单词本）
export const redeemCode = (code: string) =>
  api.post('/subscription/redeem', { code });

// 管理员：发码表单用的「分组 → 学段 → 书」三级目录
export const getBookGroups = () =>
  api.get<{ groups: BookGroup[] }>('/admin/subscriptions/book-groups');

/** 卡种/时长政策 —— 谁能发什么卡。真源在后端 subscription_service.card_policy_for
 *
 * ⚠️ 前端**不要自己写死上限**(机构半年 = 180 天):写死了改上限时两处必然漂移,
 * 结果是界面让你选、后端 403。表单一律照这份结果画。 */
export interface CardPolicy {
  role: string;
  allowed_grant_types: string[];   // 机构只有 ['period']
  max_grant_days: number;
  default_grant_days: number;
  max_grant_times: number | null;
  note: string;
  grant_type_labels: Record<string, string>;
}

export const getCardPolicy = () =>
  api.get<CardPolicy>('/admin/subscriptions/card-policy');

// 管理员：批量生成兑换码
// book_ids 传一批书 = 一码多书(按分组/学段批量开);book_id 是旧的单书字段
export const generateCodes = (data: {
  count: number;
  book_id?: number;
  book_ids?: number[];
  batch_note?: string;
  grant_type?: string;     // permanent/period/times
  grant_days?: number;     // 包月:有效天数
  grant_times?: number;    // 次卡:可用天数
  scope_series?: string;   // 发码条件留痕(仅展示/追溯)
  scope_stage?: BookStage;
}) => api.post('/admin/subscriptions/generate', data);

// 管理员：兑换码列表(search 支持码片段/批次备注模糊搜)
export const listCodes = (params: {
  page?: number;
  page_size?: number;
  status?: string;
  search?: string;
}) => api.get('/admin/subscriptions/codes', { params });

// 管理员：兑换码统计
export const getSubscriptionStats = () =>
  api.get('/admin/subscriptions/stats');

// 管理员：禁用兑换码(留痕,码仍在列表里)
export const disableCode = (codeId: number) =>
  api.post(`/admin/subscriptions/codes/${codeId}/disable`);

// 管理员：删除兑换码(彻底删行,不可恢复;已使用的码后端拒绝删除)
export const deleteCode = (codeId: number) =>
  api.delete(`/admin/subscriptions/codes/${codeId}`);

// 学生端:我兑换的书本(含剩余量/到期时间)
export const getMyPurchasedBooks = () =>
  api.get('/subscription/my-books');
