import api from './client';

export type PkPhase = 'classify' | 'speech' | 'dictation' | 'exam' | 'summary';
export type PkStatus = 'waiting' | 'playing' | 'finished' | 'abandoned';

export type PkMode = 'individual' | 'team';

export interface PkPlayer {
  user_id: number;
  nickname: string;
  online: boolean;
  correct: number;
  wrong: number;
  total_time_ms: number;
  points: number;
  streak: number;
  finished: boolean;
  team?: number | null;
  n_words?: number;   // 该玩家私有词表大小
  // 掌握赛(分类记忆法流程):阶段 + 第几组 + 掌握进度
  stage?: string;
  group_idx?: number;
  group_total?: number;
  progress?: number;
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
  countdown_seconds: number;      // 全场倒计时秒数
  deadline_at: string | null;     // 倒计时截止(ISO,开局后有值)
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
  online: boolean;
  rank: number;
  team?: number | null;
  // 掌握赛
  stage?: string;
  group_idx?: number;
  group_total?: number;
  progress?: number;
  finished?: boolean;
  finished_at_ms?: number | null;
}

/** game_finished 事件里的个人最终排名 */
export interface PkFinalRankItem {
  user_id: number;
  nickname?: string;
  rank: number;
  correct: number;
  wrong: number;
  total_time_ms: number;
  accuracy: number;
  final_score: number;
  best_streak?: number;
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

/** 教师大厅「我的房间」列表项(当前进行中的内存态房间) */
export interface MyRoomItem {
  room_id: number;
  invite_code: string;
  status: PkStatus;
  mode: PkMode;
  word_count: number;
  player_count: number;
  online_count: number;
  created_at: string | null;
  started_at: string | null;
}

export const pkApi = {
  createRoom: (
    maxPlayers: number,
    wordCount: number,
    mode: PkMode = 'individual',
    teamCount = 2,
    countdownSeconds = 300,
  ) =>
    api.post<CreateRoomResponse>('/pk/rooms', {
      max_players: maxPlayers,
      word_count: wordCount,
      mode,
      team_count: teamCount,
      countdown_seconds: countdownSeconds,
    }),

  lookupByCode: (code: string) =>
    api.get<PkRoomSnapshot>(`/pk/rooms/by-code/${code}`),

  joinRoomByCode: (code: string) =>
    api.post<PkRoomSnapshot>(`/pk/rooms/by-code/${code}/join`),

  spectateByCode: (code: string) =>
    api.post<PkRoomSnapshot>(`/pk/rooms/by-code/${code}/spectate`),

  myHistory: () => api.get<PkHistoryItem[]>('/pk/me/history'),

  // 教师大厅:我当前还开着的房间(切网页不再自动回收,回来能看到并重进/删除)
  myRooms: () => api.get<MyRoomItem[]>('/pk/rooms/mine'),

  deleteRoom: (roomId: number) => api.delete<void>(`/pk/rooms/${roomId}`),
};
