import client from './client';

export type LeaderboardKind = 'vocabulary' | 'diligence' | 'accuracy';
export type LeaderboardPeriod = 'this_week' | 'last_week' | 'this_month';
export type LeaderboardScope = 'class' | 'all';

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
  scope: LeaderboardScope;
  class_name: string | null;
  top: LeaderboardEntry[];
  my_rank: number | null;
  my_value: number;
  my_delta: number;
  total_participants: number;
}

export const getLeaderboard = async (
  kind: LeaderboardKind,
  period: LeaderboardPeriod,
  scope: LeaderboardScope = 'all',
): Promise<LeaderboardResponse> => {
  return client.get(`/student/leaderboard`, { params: { kind, period, scope } });
};
