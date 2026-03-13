import client from './client';

export interface Achievement {
  id: number;
  name: string;
  description?: string;
  icon?: string;
  condition_type?: string;
  condition_value?: number;
  reward_points: number;
  unlocked: boolean;
  unlocked_at?: string;
}

export interface UnlockedAchievement {
  id: number;
  name: string;
  description: string;
  icon: string;
  reward_points: number;
}

export interface UserAchievements {
  achievements: Achievement[];
  total_unlocked: number;
  total_points: number;
}

export interface UserStats {
  total_words: number;
  consecutive_days: number;
  total_points: number;
}

// 获取当前用户的成就列表
export const getMyAchievements = async (): Promise<UserAchievements> => {
  return client.get('/achievements/my');
};

// 检查并解锁新成就
export const checkAchievements = async (data: {
  mode: string;
  score: number;
  total: number;
  time_spent?: number;
}): Promise<UnlockedAchievement[]> => {
  return client.post('/achievements/check', data);
};

// 记录学习打卡
export const recordStudy = async (data: {
  words_learned?: number;
  duration?: number;
}): Promise<any> => {
  return client.post('/achievements/record-study', data);
};

// 获取用户统计数据
export const getMyStats = async (): Promise<UserStats> => {
  return client.get('/achievements/stats');
};
