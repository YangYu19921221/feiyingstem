import client from './client';

export type LeaderboardKind = 'vocabulary' | 'diligence' | 'accuracy';
export type LeaderboardPeriod = 'today' | 'this_week' | 'last_week' | 'this_month';
export type LeaderboardScope = 'class' | 'global';

export interface LeaderboardEntry {
  user_id: number;
  username: string;
  full_name: string | null;
  value: number;
  rank: number;
}

export interface LeaderboardResponse {
  kind: LeaderboardKind;
  period: LeaderboardPeriod;
  scope: LeaderboardScope;        // 实际生效范围（无班级时即使请求 class 也回 global）
  has_class: boolean;             // 学生是否在班级里 → 决定是否显示班级榜开关
  class_name: string | null;
  top: LeaderboardEntry[];
  neighbors: LeaderboardEntry[];  // 我的上下各 2 名（含自己），rank 升序
  my_rank: number | null;
  my_value: number;
  my_delta: number;
  total_participants: number;
}

export const getLeaderboard = async (
  kind: LeaderboardKind,
  period: LeaderboardPeriod,
  scope: LeaderboardScope = 'class',
): Promise<LeaderboardResponse> => {
  return client.get(`/student/leaderboard`, { params: { kind, period, scope } });
};
