import api from './client';

/** 学段档位(真源在后端 services/book_stage,「其他」放的是校本教材/大学/无学段的书) */
export type BookStage = 'primary' | 'junior' | 'senior' | 'other';

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
