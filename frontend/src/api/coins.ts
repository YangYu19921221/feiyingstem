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
  day_tasks_done?: number | null;  // 系统流水: 当天完成任务数
  day_tasks_total?: number | null; // 系统流水: 当天应完成任务数(不含被取消/关闭的)
  day_words?: number | null;       // 系统流水: 当天学习单词数
  day_units_done?: number | null;  // 系统流水: 当天完成单元数
  king_label?: string | null;      // word_king 徽章文案(后端按北京时间算)
}

export interface CoinTxPage {
  total: number;
  page: number;
  page_size: number;
  items: CoinTx[];
}

// ---------- 金币发放模式(自动 / 教师手动)----------
export interface CoinModeResp {
  mode: 'auto' | 'manual';
  can_edit: boolean;          // 仅管理员/机构管理员可改
  rules: {
    task_reward: number;
    word_king_reward: number;
    daily_cap: number;
    unit_coin_enabled: boolean;
  };
}
export const getCoinMode = () => client.get<CoinModeResp>(`/teacher/coins/mode`);
export const setCoinMode = (mode: 'auto' | 'manual') =>
  client.patch<{ success: boolean; mode: string }>(`/teacher/coins/mode`, { mode });

/** 手动补一次某天的系统结算(幂等);平时由每晚 00:35 自动跑,这是兜底按钮 */
export const settleCoins = (targetDate?: string) =>
  client.post<{ date: string; word_king: number; task: number; unit: number }>(
    `/teacher/coins/settle`, undefined,
    { params: targetDate ? { target_date: targetDate } : {} },
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
  pin?: string;
}) => client.post<{ success: boolean; tx_id: number | null; balance_after: number }>(
  `/teacher/coins/adjust`, body,
);

/** 加币 PIN:是否已设 / 设置或修改 */
export const getCoinPinStatus = () =>
  client.get<{ has_pin: boolean }>(`/teacher/coins/pin-status`);

export const setCoinPin = (newPin: string, oldPin?: string) =>
  client.post<{ success: boolean }>(`/teacher/coins/pin`, { new_pin: newPin, old_pin: oldPin });

/** 管理员帮老师重置金币密码(老师忘了旧密码时的唯一出路) */
export const resetTeacherCoinPin = (teacherId: number, newPin: string) =>
  client.post<{ success: boolean; teacher_id: number }>(
    `/teacher/coins/pin/reset`, { teacher_id: teacherId, new_pin: newPin },
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
  day_tasks_done?: number | null;
  day_tasks_total?: number | null;
  day_words?: number | null;
  day_units_done?: number | null;
  king_label?: string | null;
}

/** 今天的金币进度(学生端规则卡用) */
export interface MyCoinsToday {
  date: string;
  auto_coin: boolean;          // false=本机构由老师手动加币
  tasks_total: number;         // 今天应完成的任务数(已排除被取消/关闭的)
  tasks_done: number;
  tasks_all_done: boolean;
  task_coin_earned: boolean;   // 任务币已到手
  word_king_coin_earned: boolean;
  earned_today: number;        // 今天已进账(含老师手动奖励)
  daily_cap: number;
  task_reward: number;
  word_king_reward: number;
}
export const getMyCoinsToday = () => client.get<MyCoinsToday>(`/student/coins/today`);

/** 今日单词王争夺战况(「可能有人超越你」提示) */
export interface WordKingRace {
  date: string;
  in_class: boolean;
  settled: boolean;      // 这天是否已结算(今天=false,24点后才定)
  my_words: number;
  top_words: number;
  is_leading: boolean;
  tied: boolean;
  chasers: number;       // 紧追者人数(差距<=3词)
  gap: number;           // 落后第一多少词
  tip: string;           // 后端算好的提示语
  level: 'none' | 'idle' | 'tied' | 'chased' | 'leading' | 'behind';
  reward: number;
  auto_coin: boolean;
}
export const getWordKingRace = () => client.get<WordKingRace>(`/student/word-king-race`);

export interface MyCoinsResp {
  balance: number;
  total: number;
  page: number;
  page_size: number;
  items: MyCoinTx[];
}

export const getMyCoins = (page = 1, pageSize = 20) =>
  client.get<MyCoinsResp>(`/student/coins/me`, { params: { page, page_size: pageSize } });

// 我是不是单词王(戴 👑);默认今天实时,可传日期查历史
export const getMyWordKingStatus = (targetDate?: string) =>
  client.get<{ date: string; is_word_king: boolean }>(`/student/word-king-status`, {
    params: targetDate ? { target_date: targetDate } : {},
  });

// 某班某天的单词王 id 列表(教师端班级/大屏戴 👑)
export const getClassWordKings = (classId: number, targetDate?: string) =>
  client.get<{ date: string; class_id: number; king_ids: number[] }>(`/teacher/coins/word-kings`, {
    params: { class_id: classId, ...(targetDate ? { target_date: targetDate } : {}) },
  });

// 金币流水页顶部横幅:昨天单词王(已定)+ 今日实时单词王(含词数)
export interface WordKingItem { student_id: number; name: string; words: number; }
export interface WordKingBanner {
  class_id: number;
  yesterday: { date: string; kings: WordKingItem[] };
  today: { date: string; kings: WordKingItem[] };
}
export const getWordKingBanner = (classId: number) =>
  client.get<WordKingBanner>(`/teacher/coins/word-king-banner`, { params: { class_id: classId } });

// ---------- 兑换商品(奖励) ----------
export interface CoinReward {
  id: number;
  name: string;
  cost: number;
  stock: number | null;   // null = 不限量
  is_active: boolean;
  note: string | null;
  sort_order: number;
  image_url: string | null;
}

export const getRewards = (includeInactive = true) =>
  client.get<CoinReward[]>(`/teacher/coins/rewards`, { params: { include_inactive: includeInactive } });

export const createReward = (body: { name: string; cost: number; stock?: number | null; note?: string }) =>
  client.post<CoinReward>(`/teacher/coins/rewards`, body);

export const updateReward = (id: number, body: Partial<{ name: string; cost: number; stock: number | null; is_active: boolean; note: string }>) =>
  client.patch<CoinReward>(`/teacher/coins/rewards/${id}`, body);

export const deleteReward = (id: number) =>
  client.delete<{ success: boolean }>(`/teacher/coins/rewards/${id}`);

export const redeemReward = (studentId: number, rewardId: number) =>
  client.post<{ success: boolean; tx_id: number | null; balance_after: number; stock: number | null }>(
    `/teacher/coins/redeem`, { student_id: studentId, reward_id: rewardId },
  );

// 商品图上传(FormData)
export const uploadRewardImage = (rewardId: number, file: File) => {
  const fd = new FormData();
  fd.append('file', file);
  return client.post<{ image_url: string }>(`/teacher/coins/rewards/${rewardId}/image`, fd);
};

// ---------- 教师端:兑换申请审批 ----------
export interface RedeemRequestItem {
  id: number;
  student_id: number;
  student_name: string | null;
  reward_name: string;
  cost: number;
  status: string;         // pending/approved/rejected
  created_at: string;
  reviewed_at: string | null;
}
export const getRedeemRequests = (statusFilter = 'pending') =>
  client.get<{ pending_count: number; items: RedeemRequestItem[] }>(
    `/teacher/coins/redeem-requests`, { params: { status_filter: statusFilter } });
export const approveRedeem = (reqId: number) =>
  client.post<{ success: boolean }>(`/teacher/coins/redeem-requests/${reqId}/approve`);
export const rejectRedeem = (reqId: number) =>
  client.post<{ success: boolean }>(`/teacher/coins/redeem-requests/${reqId}/reject`);

// ---------- 学生端:申请兑换 ----------
export interface StudentReward {
  id: number;
  name: string;
  cost: number;
  note: string | null;
  image_url: string | null;
  stock: number | null;
  sold_out: boolean;
  pending: boolean;       // 我已有待审批申请
}
export interface MyRedeemRequest {
  id: number;
  reward_name: string;
  cost: number;
  status: string;
  created_at: string;
  reviewed_at: string | null;
}
export const getStudentRewards = () =>
  client.get<{ balance: number; rewards: StudentReward[] }>(`/student/rewards`);
export const getMyRedeemRequests = () =>
  client.get<MyRedeemRequest[]>(`/student/redeem-requests/mine`);
export const applyRedeem = (rewardId: number) =>
  client.post<{ success: boolean; request_id: number }>(`/student/redeem-requests`, { reward_id: rewardId });
