/**
 * 教师端-金币管理 API
 * client 拦截器已返回 response.data 并自动带 token。
 * 注意:client 包装器只吃一个泛型(=返回类型),不要写两个。
 */
import client from './client';

export interface CoinBalance {
  student_id: number;
  name: string;
  username: string;
  balance: number;
}

export interface CoinBalancesResp {
  class_id: number;
  class_name: string;
  students: CoinBalance[];
}

export interface CoinTx {
  id: number;
  student_id: number;
  student_name: string | null;
  amount: number;
  balance_after: number;
  source: string;         // task/word_king/manual/redeem
  source_label: string;
  reason: string | null;
  operator_id: number | null;
  created_at: string;
}

export interface CoinTxPage {
  total: number;
  page: number;
  page_size: number;
  items: CoinTx[];
}

export const settleCoins = (targetDate?: string) =>
  client.post<{ date: string; word_king: number; task: number }>(
    `/teacher/coins/settle`, null, { params: targetDate ? { target_date: targetDate } : {} },
  );

export const getCoinBalances = (classId: number, q?: string) =>
  client.get<CoinBalancesResp>(`/teacher/coins/balances`, {
    params: { class_id: classId, ...(q ? { q } : {}) },
  });

export const getCoinTransactions = (params: {
  class_id?: number;
  student_id?: number;
  source?: string;
  q?: string;
  target_date?: string;
  page?: number;
  page_size?: number;
}) => client.get<CoinTxPage>(`/teacher/coins/transactions`, { params });

export const adjustCoins = (body: {
  student_id: number;
  amount: number;
  reason?: string;
  source?: 'manual' | 'redeem';
}) => client.post<{ success: boolean; tx_id: number | null; balance_after: number }>(
  `/teacher/coins/adjust`, body,
);

export const updateCoinTx = (txId: number, body: { amount?: number; reason?: string }) =>
  client.patch<{ success: boolean }>(`/teacher/coins/transactions/${txId}`, body);

export const deleteCoinTx = (txId: number) =>
  client.delete<{ success: boolean }>(`/teacher/coins/transactions/${txId}`);

// ---------- 学生端:我的金币 ----------
export interface MyCoinTx {
  id: number;
  amount: number;
  source: string;
  source_label: string;
  reason: string | null;
  created_at: string;
}

export interface MyCoinsResp {
  balance: number;
  total: number;
  page: number;
  page_size: number;
  items: MyCoinTx[];
}

export const getMyCoins = (page = 1, pageSize = 20) =>
  client.get<MyCoinsResp>(`/student/coins/me`, { params: { page, page_size: pageSize } });
