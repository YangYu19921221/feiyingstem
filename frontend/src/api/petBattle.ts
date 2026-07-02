import api from './client';

// ========================================
// 宠物对战系统 API
// ========================================

export interface PetBattleInfo {
  pet_id: number;
  name: string;
  species: string;
  level: number;
  evolution_stage: number;
  hp: number;
  max_hp: number;
  combo: number;
  ultimate_charges: number;
}

export interface QuestionData {
  word_id: number;
  word: string;
  question_text: string;
  options: string[];
}

export interface RoundResult {
  round_number: number;
  question: QuestionData;
  player1_answer: string | null;
  player1_correct: boolean;
  player1_time_ms: number | null;
  player1_damage: number;
  player1_used_ultimate: boolean;
  player1_hp_after: number;
  player2_answer: string | null;
  player2_correct: boolean;
  player2_time_ms: number | null;
  player2_damage: number;
  player2_used_ultimate: boolean;
  player2_hp_after: number;
}

export interface Battle {
  id: number;
  status: string;
  mode: string;
  current_round: number;
  max_rounds: number;
  player1_id: number;
  player1_username: string;
  player1_pet: PetBattleInfo;
  player1_total_correct: number;
  player1_total_damage: number;
  player2_id: number;
  player2_username: string;
  player2_pet: PetBattleInfo;
  player2_total_correct: number;
  player2_total_damage: number;
  winner_id: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  expires_at: string | null;
}

export interface BattleListItem {
  id: number;
  opponent_username: string;
  opponent_pet_name: string;
  status: string;
  mode: string;
  result: string | null;
  created_at: string;
}

export interface BattleStats {
  total_battles: number;
  wins: number;
  losses: number;
  draws: number;
  win_rate: number;
  current_win_streak: number;
  max_win_streak: number;
  total_damage_dealt: number;
  total_damage_taken: number;
  avg_damage_per_battle: number;
  accuracy: number;
  ultimates_used: number;
  ultimates_landed: number;
  perfect_wins: number;
  comeback_wins: number;
  rating: number;
  peak_rating: number;
}

export interface CreateBattleRequest {
  opponent_id: number;
  wordbook_id?: number;
  mode?: string;
  max_rounds?: number;
}

// ========== HTTP API ==========

export const createBattle = async (data: CreateBattleRequest): Promise<Battle> => {
  return api.post('/student/battle/create', data);
};

export const acceptBattle = async (battleId: number): Promise<Battle> => {
  return api.post(`/student/battle/${battleId}/accept`);
};

export const cancelBattle = async (battleId: number): Promise<{ message: string }> => {
  return api.post(`/student/battle/${battleId}/cancel`);
};

export const getBattle = async (battleId: number): Promise<Battle> => {
  return api.get(`/student/battle/${battleId}`);
};

export const getMyBattles = async (status?: string, limit = 20): Promise<BattleListItem[]> => {
  return api.get('/student/battles/my', { params: { status, limit } });
};

export const getPendingInvites = async (): Promise<Battle[]> => {
  return api.get('/student/battles/invites');
};

export const getBattleStats = async (): Promise<BattleStats> => {
  return api.get('/student/battles/stats');
};

// ========== WebSocket ==========

export interface WSMessage {
  type: string;
  [key: string]: any;
}

export class BattleWebSocket {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<(data: any) => void>> = new Map();
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private battleId: number;
  private token: string;

  constructor(battleId: number, token: string) {
    this.battleId = battleId;
    this.token = token;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `${import.meta.env.VITE_WS_URL || 'ws://localhost:8000'}/api/v1/student/battle/ws/${this.battleId}?token=${this.token}`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('Battle WebSocket connected');
        this.reconnectAttempts = 0;
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.emit(data.type, data);
        } catch (error) {
          console.error('Failed to parse WS message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('Battle WebSocket error:', error);
        reject(error);
      };

      this.ws.onclose = () => {
        console.log('Battle WebSocket closed');
        this.emit('close', {});
        this.attemptReconnect();
      };
    });
  }

  on(event: string, callback: (data: any) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: (data: any) => void) {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  private emit(event: string, data: any) {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.forEach((callback) => callback(data));
    }
  }

  send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.error('WebSocket not connected');
    }
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);

    console.log(`Attempting reconnect in ${delay}ms...`);

    this.reconnectTimeout = setTimeout(() => {
      this.connect().catch((error) => {
        console.error('Reconnect failed:', error);
      });
    }, delay);
  }

  close() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// ========== 答题WebSocket(独立通道) ==========

export class AnswerWebSocket {
  private ws: WebSocket | null = null;
  private battleId: number;
  private token: string;

  constructor(battleId: number, token: string) {
    this.battleId = battleId;
    this.token = token;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `${import.meta.env.VITE_WS_URL || 'ws://localhost:8000'}/api/v1/student/battle/ws/${this.battleId}/answer?token=${this.token}`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('Answer WebSocket connected');
        resolve();
      };

      this.ws.onerror = (error) => {
        console.error('Answer WebSocket error:', error);
        reject(error);
      };
    });
  }

  submitAnswer(roundNumber: number, answer: string, timeMs: number, useUltimate = false) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          round_number: roundNumber,
          answer,
          time_ms: timeMs,
          use_ultimate: useUltimate,
        })
      );
    }
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
