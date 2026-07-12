import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import './_axiosBootstrap';

// ============ PK 晋级赛 API ============

export interface TournamentListItem {
  id: number;
  name: string;
  status: 'running' | 'finished';
  created_at: string | null;
  champion_id: number | null;
}

export interface GroupPlayer {
  user_id: number;
  name: string;
  points: number;
  wins: number;
  losses: number;
  correct_total: number;
  qualified: boolean;
}

export interface TournamentMatch {
  id: number;
  stage: 'group' | 'ko' | 'consolation';
  round_no: number;
  bracket_pos: number;
  group_no: number | null;
  p1_id: number;
  p1_name: string;
  p2_id: number | null;
  p2_name: string;
  winner_id: number | null;
  status: 'pending' | 'finished' | 'bye';
  p1_correct: number | null;
  p1_score: number | null;
  p2_correct: number | null;
  p2_score: number | null;
  invite_code: string | null;
}

export interface TournamentDetail {
  id: number;
  name: string;
  status: 'running' | 'finished';
  group_size: number;
  word_count: number;
  has_consolation: boolean;
  champion_id: number | null;
  champion_name: string | null;
  consolation_champion_id: number | null;
  consolation_champion_name: string | null;
  groups: { group_no: number; players: GroupPlayer[] }[];
  matches: TournamentMatch[];
}

export interface MyMatch {
  match_id: number;
  tournament_id: number;
  tournament_name: string;
  stage: 'group' | 'ko' | 'consolation';
  round_no: number;
  group_no: number | null;
  opponent_id: number | null;
  opponent_name: string;
  invite_code: string | null;
}

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('access_token')}` });

export interface CreateTournamentBody {
  name: string;
  class_ids: number[];
  unit_ids: number[];
  group_size: number;
  word_count: number;
  has_consolation: boolean;
}

export const tournamentApi = {
  create: async (body: CreateTournamentBody) => {
    const r = await axios.post(`${API_BASE_URL}/pk/tournaments`, body, { headers: auth() });
    return r.data as { id: number; name: string; player_count: number };
  },
  list: async () => {
    const r = await axios.get(`${API_BASE_URL}/pk/tournaments`, { headers: auth() });
    return r.data as TournamentListItem[];
  },
  detail: async (id: number) => {
    const r = await axios.get(`${API_BASE_URL}/pk/tournaments/${id}`, { headers: auth() });
    return r.data as TournamentDetail;
  },
  remove: async (id: number) => {
    await axios.delete(`${API_BASE_URL}/pk/tournaments/${id}`, { headers: auth() });
  },
  myMatches: async () => {
    const r = await axios.get(`${API_BASE_URL}/pk/tournaments/my-matches`, { headers: auth() });
    return r.data as MyMatch[];
  },
  enterMatch: async (matchId: number) => {
    const r = await axios.post(`${API_BASE_URL}/pk/tournament-matches/${matchId}/enter`, {}, { headers: auth() });
    return r.data as { room_id: number; invite_code: string };
  },
};
