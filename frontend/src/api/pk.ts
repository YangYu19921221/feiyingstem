import api from './client';

export type PkPhase = 'classify' | 'speech' | 'dictation' | 'exam' | 'summary';
export type PkStatus = 'waiting' | 'playing' | 'finished' | 'abandoned';

export type PkMode = 'individual' | 'team';

export interface PkPlayer {
  user_id: number;
  nickname: string;
  online: boolean;
  current_word_idx: number;
  correct: number;
  wrong: number;
  total_time_ms: number;
  points: number;
  streak: number;
  finished: boolean;
  team?: number | null;
}

export interface PkSpectator {
  user_id: number;
  nickname: string;
  online: boolean;
}

export interface PkRoomSnapshot {
  room_id: number;
  invite_code: string;
  host_id: number;
  unit_id: number | null;
  max_players: number;
  status: PkStatus;
  current_phase: PkPhase;
  current_word_idx: number;
  total_words: number;   // 开局前为 0,开局后 = 实际抽到的词数
  word_count: number;    // 房主设定的目标词数
  mode: PkMode;          // individual=个人赛 / team=分组赛
  team_count: number;    // 分组赛队伍数
  host_is_player: boolean; // 房主是否下场(教师组织房为 false)
  players: PkPlayer[];
  spectators: PkSpectator[];
}

/** 队伍榜单一行(分组赛) */
export interface PkTeamRankItem {
  team: number;
  rank: number;
  points: number;       // 队伍总分(展示用)
  avg_points: number;   // 人均分(排名依据,人多不占优)
  correct: number;
  wrong: number;
  total_time_ms: number;
  member_count: number;
  online_count: number;
}

/** live_ranking 事件里的单行榜单数据 */
export interface PkLiveRankItem {
  user_id: number;
  nickname: string;
  points: number;
  correct: number;
  wrong: number;
  streak: number;
  total_time_ms: number;
  current_word_idx: number;
  online: boolean;
  rank: number;
  team?: number | null;
}

export interface PkHistoryItem {
  room_id: number;
  invite_code: string;
  unit_id: number;
  finished_at: string | null;
  rank: number | null;
  accuracy: number | null;
  final_score: number | null;
}

export interface CreateRoomResponse {
  room_id: number;
  invite_code: string;
}

export const pkApi = {
  createRoom: (
    maxPlayers: number,
    wordCount: number,
    mode: PkMode = 'individual',
    teamCount = 2,
  ) =>
    api.post<CreateRoomResponse>('/pk/rooms', {
      max_players: maxPlayers,
      word_count: wordCount,
      mode,
      team_count: teamCount,
    }),

  lookupByCode: (code: string) =>
    api.get<PkRoomSnapshot>(`/pk/rooms/by-code/${code}`),

  joinRoomByCode: (code: string) =>
    api.post<PkRoomSnapshot>(`/pk/rooms/by-code/${code}/join`),

  spectateByCode: (code: string) =>
    api.post<PkRoomSnapshot>(`/pk/rooms/by-code/${code}/spectate`),

  myHistory: () => api.get<PkHistoryItem[]>('/pk/me/history'),
};
