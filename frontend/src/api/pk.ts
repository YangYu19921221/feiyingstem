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
  finished: boolean;
}

export interface PkRoomSnapshot {
  room_id: number;
  invite_code: string;
  host_id: number;
  unit_id: number;
  max_players: number;
  status: PkStatus;
  current_phase: PkPhase;
  current_word_idx: number;
  total_words: number;
  players: PkPlayer[];
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
  createRoom: (unitId: number, maxPlayers: number) =>
    api.post<CreateRoomResponse>('/pk/rooms', {
      unit_id: unitId,
      max_players: maxPlayers,
    }),

  lookupByCode: (code: string) =>
    api.get<PkRoomSnapshot>(`/pk/rooms/by-code/${code}`),

  myHistory: () => api.get<PkHistoryItem[]>('/pk/me/history'),
};
