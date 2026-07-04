import api from './client';

export type PkPhase = 'classify' | 'speech' | 'dictation' | 'exam' | 'summary';
export type PkStatus = 'waiting' | 'playing' | 'finished' | 'abandoned';

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
  players: PkPlayer[];
  spectators: PkSpectator[];
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
  createRoom: (maxPlayers: number, wordCount: number) =>
    api.post<CreateRoomResponse>('/pk/rooms', {
      max_players: maxPlayers,
      word_count: wordCount,
    }),

  lookupByCode: (code: string) =>
    api.get<PkRoomSnapshot>(`/pk/rooms/by-code/${code}`),

  joinRoomByCode: (code: string) =>
    api.post<PkRoomSnapshot>(`/pk/rooms/by-code/${code}/join`),

  spectateByCode: (code: string) =>
    api.post<PkRoomSnapshot>(`/pk/rooms/by-code/${code}/spectate`),

  myHistory: () => api.get<PkHistoryItem[]>('/pk/me/history'),
};
