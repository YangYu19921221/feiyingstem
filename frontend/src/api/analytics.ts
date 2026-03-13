import client from './client';

export interface LearningOverview {
  total_words: number;
  mastered_words: number;
  learning_words: number;
  weak_words: number;
  total_study_days: number;
  total_duration: number;
  avg_daily_words: number;
  current_streak: number;
}

export interface DailyStats {
  date: string;
  words_learned: number;
  duration: number;
  accuracy: number;
}

export interface ModeStats {
  mode: string;
  count: number;
  avg_accuracy: number;
  total_words: number;
}

export interface RecentActivity {
  date: string;
  mode: string;
  unit_name: string;
  score: number;
  total: number;
  duration: number;
}

// 获取学习总览
export const getLearningOverview = async (): Promise<LearningOverview> => {
  return client.get('/analytics/overview');
};

// 获取每日统计(最近N天)
export const getDailyStats = async (days: number = 30): Promise<DailyStats[]> => {
  return client.get(`/analytics/daily-stats?days=${days}`);
};

// 获取各模式统计
export const getModeStats = async (): Promise<ModeStats[]> => {
  return client.get('/analytics/mode-stats');
};

// 获取最近活动
export const getRecentActivities = async (limit: number = 10): Promise<RecentActivity[]> => {
  return client.get(`/analytics/recent-activities?limit=${limit}`);
};

// 获取日历热力图数据
export const getCalendarData = async (year: number, month: number): Promise<any> => {
  return client.get(`/analytics/calendar-data?year=${year}&month=${month}`);
};

// ===== 记忆曲线 =====

export interface RetentionDataPoint {
  hours_since_learning: number;
  label: string;
  theoretical_retention: number;
  actual_retention: number | null;
  sample_size: number;
}

export interface RetentionCurveResponse {
  data_points: RetentionDataPoint[];
  total_words_learned: number;
  has_enough_data: boolean;
  message: string;
}

// 获取记忆曲线数据
export const getRetentionCurve = async (): Promise<RetentionCurveResponse> => {
  return client.get('/analytics/retention-curve');
};
