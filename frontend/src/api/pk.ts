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
  /** 学生自选的组号,null=还没选组;组名用 team_names 映射(见 utils/pkTeam) */
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
  team_count: number;    // 分组赛组数 = 教师建房时建的组数
  /** 组号 → 组名(教师建房时起的);学生在等待室据此选组 */
  team_names?: Record<string, string>;
  host_is_player: boolean; // 房主是否下场(教师组织房为 false)
  countdown_seconds: number;      // 全场倒计时秒数
  deadline_at: string | null;     // 倒计时截止(ISO,开局后有值)
  players: PkPlayer[];
  spectators: PkSpectator[];
}

/** 队伍榜单一行(分组赛) */
export interface PkTeamRankItem {
  team: number;
  /** 队名 = 班级名(分组赛按班级自动分队);老房间可能缺,回退「第N队」 */
  team_name?: string | null;
  rank: number;
  points: number;       // 队伍总分(展示用)
  avg_points: number;   // 人均得分(排名依据)
  avg_potential?: number;  // 人均满分(展示 "人均 x / 满分")
  correct: number;
  wrong: number;
  total_time_ms: number;
  member_count: number;
  online_count: number;
  /** 队内人均掌握进度 0~1(仅展示;排名与柱高都按 avg_points) */
  avg_progress?: number;
  /** 队里已跑完全流程的人数(排名第一依据) */
  done_count?: number;
}

/** live_ranking 事件里的单行榜单数据 */
export interface PkLiveRankItem {
  user_id: number;
  nickname: string;
  /** 得分 = 掌握进度 × 满分(决定胜负) */
  points: number;
  /** 满分:该玩家词表的难度分之和(小学100/初中120/高中150 每词) */
  potential_points?: number;
  correct: number;
  wrong: number;
  streak: number;
  total_time_ms: number;
  online: boolean;
  rank: number;
  /** 队号;队名用房间快照的 team_names 映射(实时榜每行不带班名,省广播带宽) */
  team?: number | null;
  // 掌握赛
  stage?: string;
  group_idx?: number;
  group_total?: number;
  progress?: number;
  finished?: boolean;
  finished_at_ms?: number | null;
}

/** live_ranking 事件:大房间时 ranking 已被服务端裁成「前10名 + 自己」,
 *  total_players 给出全场真实人数(裁剪后才有此字段) */
export interface PkLiveRankingEvent {
  ranking: PkLiveRankItem[];
  total_players?: number;
  team_ranking?: PkTeamRankItem[];
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
  /** 队号;队名见同一事件的 team_ranking */
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
  // 分组赛:teamNames = 教师自己建的组名,学生进房后各自选组
  createRoom: (
    maxPlayers: number,
    wordCount: number,
    mode: PkMode = 'individual',
    countdownSeconds = 300,
    teamNames: string[] = [],
  ) =>
    api.post<CreateRoomResponse>('/pk/rooms', {
      max_players: maxPlayers,
      word_count: wordCount,
      mode,
      countdown_seconds: countdownSeconds,
      team_names: teamNames,
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
