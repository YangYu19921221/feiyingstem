import client from './client';

export type LeaderboardKind = 'vocabulary' | 'diligence' | 'accuracy';
export type LeaderboardPeriod = 'this_week' | 'last_week' | 'this_month';

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
  top: LeaderboardEntry[];
  my_rank: number | null;
  my_value: number;
  my_delta: number;
  total_participants: number;
}

export const getLeaderboard = async (
  kind: LeaderboardKind,
  period: LeaderboardPeriod,
): Promise<LeaderboardResponse> => {
  return client.get(`/student/leaderboard`, { params: { kind, period } });
};
