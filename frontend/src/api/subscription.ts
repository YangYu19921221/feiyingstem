import api from './client';

// 兑换码激活（兑换单词本）
export const redeemCode = (code: string) =>
  api.post('/subscription/redeem', { code });

// 管理员：批量生成兑换码（绑定单词本）
export const generateCodes = (data: {
  count: number;
  book_id: number;
  batch_note?: string;
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
