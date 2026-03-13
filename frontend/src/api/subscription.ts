import api from './client';

// 订阅状态查询
export const getSubscriptionStatus = () =>
  api.get('/subscription/status');

// 兑换码激活
export const redeemCode = (code: string) =>
  api.post('/subscription/redeem', { code });

// 管理员：批量生成兑换码
export const generateCodes = (data: {
  count: number;
  duration_days: number;
  batch_note?: string;
}) => api.post('/admin/subscriptions/generate', data);

// 管理员：兑换码列表
export const listCodes = (params: {
  page?: number;
  page_size?: number;
  status?: string;
}) => api.get('/admin/subscriptions/codes', { params });

// 管理员：订阅统计
export const getSubscriptionStats = () =>
  api.get('/admin/subscriptions/stats');

// 管理员：禁用兑换码
export const disableCode = (codeId: number) =>
  api.post(`/admin/subscriptions/codes/${codeId}/disable`);
