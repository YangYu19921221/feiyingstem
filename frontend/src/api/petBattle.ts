import api from './client';
import { getWebSocketUrl } from '../config/websocket';

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

export interface BattlePetOption {
  pet_id: number;
  name: string;
  species: string;
  level: number;
  evolution_stage: number;
  hp: number;
  max_hp: number;
  is_current: boolean;
  can_switch: boolean;
}

/** 题型: 看英文选中文 / 看中文选英文(单词不提前给) / 听读音选中文(单词不显示) */
export type QuestionKind = 'en2zh' | 'zh2en' | 'listen';

export interface QuestionData {
  word_id: number;
  /** 看中文选英文的题,出题时这里是空的(它就是答案),结算时才给 */
  word: string;
  question_text: string;
  options: string[];
  kind?: QuestionKind;
  /** 题目中间那行大字: 英文单词 / 中文意思;听音题没有 */
  display?: string;
  /** 这一回合给我的「咒语」(手里有大招才有): 拼对了才放得出大招。单词本身不下发 */
  spell?: SpellChallenge | null;
  /** 真人对战时两个孩子各有各的咒语,按玩家 id 取 */
  spells_public?: Record<string, SpellChallenge> | null;
}

export interface SpellChallenge {
  meaning: string;
  length: number;
  /** 这个词的字母 + 几个干扰字母,已打乱 */
  letters: string[];
}

/** 出招: 普通 / 重击(答对伤害高,答错扣得多)/ 防守(伤害低,挨打减伤,答错不扣血) */
export type Stance = 'normal' | 'heavy' | 'guard';

export interface SpellOutcome {
  ok: boolean;
  word: string;
  meaning: string;
  typed?: string | null;
}

/** 学习增益: 今天把该做的做了,这一场就更强 */
export interface BattleBuff {
  key: 'homework' | 'review' | 'words' | string;
  label: string;
  detail: string;
}

export interface BattleBuffPreview {
  enabled: boolean;
  items: Array<BattleBuff & { got: boolean; how?: string | null; route?: string | null }>;
}

export interface RoundResult {
  round_number: number;
  question: QuestionData & { correct_answer: string };
  player1_answer: string | null;
  player1_correct: boolean;
  player1_time_ms: number | null;
  player1_damage: number;
  player1_used_ultimate: boolean;
  player1_type_multiplier?: number;
  player1_type_text?: string;
  player1_hp_after: number;
  player1_combo: number;
  player1_ultimate_charges: number;
  /** 这一回合怎么出的招;guarded = 挨的打被防守减过;spell = 试着念咒语的结果(没试是 null) */
  player1_stance?: Stance | 'ultimate' | null;
  player1_guarded?: boolean;
  player1_spell?: SpellOutcome | null;
  player2_stance?: Stance | 'ultimate' | null;
  player2_guarded?: boolean;
  player2_spell?: SpellOutcome | null;
  player2_answer: string | null;
  player2_correct: boolean;
  player2_time_ms: number | null;
  player2_damage: number;
  player2_used_ultimate: boolean;
  player2_type_multiplier?: number;
  player2_type_text?: string;
  player2_hp_after: number;
  player2_combo: number;
  player2_ultimate_charges: number;
}

export interface Battle {
  id: number;
  status: string;
  mode: string;
  /** 这一场是闯关的第几关(普通练习赛 / 真人对战没有) */
  trial?: TrialBattleInfo | null;
  /** 这一场打的是同学的影子(用他的宠物和他平时答题的水平,电脑替他打) */
  shadow?: {
    owner_name: string;
    pet_name: string;
    /** 影子对战和闯关同一套节奏: 属性克制只帮不坑、倍率比平时小 */
    type_rule?: 'help_only' | 'normal';
    type_mult?: number;
  } | null;
  /** 双方这一场带着的学习增益 */
  buffs?: { player1: BattleBuff[]; player2: BattleBuff[] } | null;
  /** 平台开着哪些玩法(老后端没有这个字段 = 都没有)。hints = 三个出招按钮下面那行带数字的小字;
   *  spell_bonus = 拼对咒语有什么好处(「拼对咒语 大招伤害 ×1.5」),念咒语那块原样显示 */
  play?: {
    stances: boolean;
    spell_ultimate: boolean;
    hints?: Partial<Record<Stance, string>> | null;
    spell_bonus?: string | null;
  } | null;
  current_round: number;
  max_rounds: number;
  player1_id: number;
  player1_username: string;
  player1_pet: PetBattleInfo;
  player1_roster: BattlePetOption[];
  player1_total_correct: number;
  player1_total_damage: number;
  player2_id: number;
  player2_username: string;
  player2_pet: PetBattleInfo;
  player2_roster: BattlePetOption[];
  player2_total_correct: number;
  player2_total_damage: number;
  winner_id: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  expires_at: string | null;
}

/** 结算页用: 这一场每一题两边答得怎么样(后端 pet_battle_service.battle_review) */
export interface BattleReviewItem {
  round: number;
  word_id: number;
  word: string;
  meaning: string;
  player1_correct: boolean;
  player2_correct: boolean;
  /** 真选了 A–D(超时没答是 false) */
  player1_answered: boolean;
  player2_answered: boolean;
  /** 这一条是念咒语时拼错的词(不是选择题) */
  spell?: boolean;
  /** 选了「防守」又答对了: 多半是拿不准蒙对的,也值得再看一眼。按人分开(真人对战时两边各看各的) */
  player1_unsure?: boolean;
  player2_unsure?: boolean;
}

export interface BattleCapture {
  eligible: boolean;
  attempted: boolean;
  success: boolean;
  chance: number;
  winner_id: number;
  loser_id: number;
  pet_name: string;
  pet_species: string;
  loser_has_no_pets: boolean;
  recovery_goal_words: number | null;
  reason: string;
  required_words?: number | null;
}

/** WS battle_end 消息 */
export interface BattleEndData {
  winner_id: number | null;
  winner_name: string | null;
  food_earned: number;
  xp_earned: number;
  rating_change: number;
  capture?: BattleCapture | null;
  /** 这一场是闯关时才有: 几星、是不是第一次过、下一关是第几关 */
  trial?: TrialResult | null;
  /** 打赢了、出战的宠物体力回满(闯关和挑战影子) */
  healed?: boolean;
  player1_final_stats: { correct: number; damage: number; hp: number };
  player2_final_stats: { correct: number; damage: number; hp: number };
  review?: BattleReviewItem[];
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

/** 可挑战的同学(同机构、已有出战宠物) */
export interface OpponentOption {
  user_id: number;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
  pet_name: string;
  pet_species: string;
  pet_level: number;
  pet_evolution_stage: number;
}

/** 查可挑战的同学列表(同机构、已有出战宠物);q 为空返回最近活跃的默认列表 */
export const searchOpponents = async (q = '', limit = 30): Promise<OpponentOption[]> => {
  return api.get('/student/battle/search-opponents', { params: { q, limit } });
};

/**
 * 这三个是老接口(老页面也在调)。老页面把报错的 detail 直接当一句话显示,所以服务端对它们只回一句话;
 * 带上这个头 = 「我是新页面,报错可以给 {code, message}」(后端 pet_battle.py 的 NEW_PAGE_HEADER,同名)。
 */
const NEW_PAGE = { headers: { 'X-EH-Battle': '2' } };

export const createBattle = async (data: CreateBattleRequest): Promise<Battle> => {
  return api.post('/student/battle/create', data, NEW_PAGE);
};

export const acceptBattle = async (battleId: number): Promise<Battle> => {
  return api.post(`/student/battle/${battleId}/accept`, null, NEW_PAGE);
};

export const quickMatchBattle = async (wordbookId?: number): Promise<Battle> => {
  return api.post('/student/battle/quick-match', null, {
    ...NEW_PAGE,
    params: { wordbook_id: wordbookId }
  });
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

/**
 * 我发出的挑战刚被接受、对手在等我进场 → 这场的 id(没有就 null)。
 * 对战大厅轮询它自动进场 —— 否则发起方不知道对方接了,接受方等 30 秒后被踢出
 */
export const getReadyBattle = async (): Promise<{ battle_id: number | null; opponent_name?: string }> => {
  return api.get('/student/battles/ready');
};

export const getPendingInvites = async (): Promise<Battle[]> => {
  return api.get('/student/battles/invites');
};

// ========== 对战场数(规则真源 backend/app/services/battle_tickets.py) ==========

export interface BattleTicketSource {
  key: 'free' | 'task' | 'review' | 'words' | string;
  label: string;
  /** 今天这一项拿到了几场 */
  got: number;
  /** 今天还能不能靠这一项再拿 */
  more: boolean;
  detail: string;
  /** 去哪儿做;null = 现在没得做 */
  route: string | null;
}

export interface BattleTickets {
  /** false = 平台关了这条规则,不限场数(下面几个数都是 null) */
  enabled: boolean;
  cap: number | null;
  earned: number | null;
  used: number | null;
  left: number | null;
  /** 今天挣到的已经到了一天的上限 */
  capped: boolean;
  sources: BattleTicketSource[];
  /** 规则说明,一行一句,原样显示 */
  lines: string[];
}

export const getBattleTickets = async (): Promise<BattleTickets> => {
  return api.get('/student/battles/tickets');
};

export interface TicketOption {
  key: string;
  label: string;
  default: boolean | number;
  choices: Array<{ value: boolean | number; label: string }>;
  effect: string;
  risk: string;
}

export interface TicketSettings {
  options: TicketOption[];
  values: Record<string, boolean | number>;
  defaults: Record<string, boolean | number>;
}

export const getTicketSettings = async (): Promise<TicketSettings> => {
  return api.get('/student/battles/ticket-settings');
};

export const saveTicketSettings = async (
  data: Record<string, boolean | number> | { reset: true },
): Promise<TicketSettings> => {
  return api.put('/student/battles/ticket-settings', data);
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
  // 主动 close 后禁止一切回调/重连(否则 StrictMode 双挂载或页面切换会产生僵尸重连)
  private closedByUser = false;

  constructor(battleId: number, token: string) {
    this.battleId = battleId;
    this.token = token;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = getWebSocketUrl(`/api/v1/student/battle/ws/${this.battleId}?token=${this.token}`);

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
        if (this.closedByUser) return; // 主动关闭引发的 error 不算失败
        console.error('Battle WebSocket error:', error);
        reject(error);
      };

      this.ws.onclose = () => {
        if (this.closedByUser) return; // 主动关闭不触发重连
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

  /** 这一场打完了: 服务端会关掉连接,别再重连(打完的对战不让再连,重连只会一遍遍失败) */
  stopReconnect() {
    this.closedByUser = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  close() {
    this.closedByUser = true;
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
  private listeners: Map<string, Set<(data: WSMessage) => void>> = new Map();
  private battleId: number;
  private token: string;
  private closedByUser = false;

  constructor(battleId: number, token: string) {
    this.battleId = battleId;
    this.token = token;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = getWebSocketUrl(`/api/v1/student/battle/ws/${this.battleId}/answer?token=${this.token}`);

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('Answer WebSocket connected');
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.listeners.get(data.type)?.forEach((callback) => callback(data));
        } catch (error) {
          console.error('Failed to parse answer WS message:', error);
        }
      };

      this.ws.onerror = (error) => {
        if (this.closedByUser) return;
        console.error('Answer WebSocket error:', error);
        reject(error);
      };
    });
  }

  submitAnswer(
    roundNumber: number, answer: string, timeMs: number, useUltimate = false,
    extra: { stance?: Stance; spell?: string } = {},
  ) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'submit_answer',
          // v: 2 = 这个页面认得「出招三选一 / 念咒语」。没带 v 的是还没刷新的老页面: 服务端对它照老规矩
          // (大招点一下就放),不然老页面上会出现「大招点了没放出来」
          v: 2,
          round_number: roundNumber,
          answer,
          time_ms: timeMs,
          use_ultimate: useUltimate,
          ...(extra.stance ? { stance: extra.stance } : {}),
          ...(extra.spell !== undefined ? { spell: extra.spell } : {}),
        })
      );
    }
  }

  switchPet(petId: number) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'switch_pet', pet_id: petId }));
    }
  }

  on(event: string, callback: (data: WSMessage) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(callback);
  }

  close() {
    this.closedByUser = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}


// ---------------------------------------------------------------- 闯关(规则在后端 services/pet_trial)

export interface TrialBattleInfo {
  stage: number;
  boss: boolean;
  arena: string;
  area_name: string;
  title: string;
  /** help_only = 属性克制只帮孩子不坑孩子(只有「你克制对手」算数) */
  type_rule?: 'help_only' | 'normal';
  /** 闯关里「你克制对手」时伤害乘几(比平时的 2 小) */
  type_mult?: number;
  /** 守关: 这一场有几道题是这个孩子自己错过的词 */
  weak_words?: number;
  /** 打完以后才有(刷新结算页时用) */
  result?: TrialResult | null;
}

export interface TrialResult {
  stage: number;
  boss: boolean;
  won: boolean;
  /** 这一场拿了几星(没赢是 0) */
  stars: number;
  best_stars: number;
  first_clear: boolean;
  /** 赢了才有下一关 */
  next_stage: number | null;
  bonus?: { food: number; xp: number } | null;
  /** 闯关赢了: 出战的宠物体力回满、不受伤 */
  healed?: boolean;
}

export interface TrialStage {
  stage: number;
  boss: boolean;
  species: string;
  pet_name: string;
  stars: number;
  cleared: boolean;
  unlocked: boolean;
  /** 对手几级、用哪个形态的图(按孩子出战宠物的等级算的) */
  level?: number;
  evolution_stage?: number;
  /** 这一关试过几次 */
  attempts?: number;
}

export interface TrialArea {
  index: number;
  arena: string;
  name: string;
  stages: TrialStage[];
}

export interface TrialOverview {
  cleared: number;
  next_stage: number;
  total_stars: number;
  lap: number;
  areas: TrialArea[];
}

export const TRIAL_QUERY_KEY = ['petTrial'] as const;

export const getTrial = async (): Promise<TrialOverview> => api.get('/student/battle/trial');

export const startTrialStage = async (stage: number): Promise<Battle> =>
  api.post(`/student/battle/trial/${stage}/start`);

/** 现在开一场会带哪些学习增益、哪些还没拿到(规则在后端) */
export const getBattleBuffs = async (): Promise<BattleBuffPreview> => api.get('/student/battles/buffs');
export const BATTLE_BUFFS_QUERY_KEY = ['battleBuffs'] as const;

// ---------------------------------------------------------------- 挑战同学的影子(规则在后端 services/pet_shadow)

export interface ShadowTarget {
  user_id: number;
  name: string;
  pet_name: string;
  species: string;
  evolution_stage: number;
  /** 按我的等级调整过(最多比我高 3 级) */
  level: number;
  /** 他平时对战的正确率,0–100 */
  accuracy: number;
  challenged_today: boolean;
}

export interface ShadowOverview {
  enabled: boolean;
  items: ShadowTarget[];
  my_record?: { defended: number; lost: number } | null;
  unseen?: number;
  reason?: string | null;
}

export interface ShadowLog {
  challenger_name: string;
  owner_won: boolean;
  at: string;
  pet_name?: string | null;
}

export const SHADOWS_QUERY_KEY = ['petShadows'] as const;
export const getShadows = async (): Promise<ShadowOverview> => api.get('/student/battle/shadows');
export const startShadowBattle = async (userId: number): Promise<Battle> =>
  api.post(`/student/battle/shadow/${userId}/start`);
export const getShadowLogs = async (mark = true): Promise<{ items: ShadowLog[] }> =>
  api.get('/student/battle/shadow-logs', { params: mark ? { mark: 1 } : undefined });

// ---------------------------------------------------------------- 全班打大怪(规则在后端 services/class_boss)

export interface ClassBossItem {
  key: 'task' | 'review' | 'words' | string;
  label: string;
  points: number;
  how?: string | null;
  route?: string | null;
}

export interface ClassBoss {
  enabled: boolean;
  has_class: boolean;
  class_name?: string;
  week_start?: string;
  week_end?: string;
  boss?: { species: string; evolution_stage: number; name: string };
  hp_max?: number;
  hp_left?: number;
  defeated?: boolean;
  /** 在学的人数(久不来的不算;大怪的血按它算) */
  students?: number;
  /** 在班人数(备查) */
  enrolled?: number;
  joined?: number;
  mine?: { total: number; today: number; today_cap: number; items: ClassBossItem[] };
  top?: Array<{ name: string; points: number }>;
  reward?: { food: number; xp: number; can_claim: boolean; claimed: boolean };
  last_week?: { defeated: boolean; can_claim: boolean } | null;
}

/** 后端最后定的路径(第五轮回报后核对) */
const CLASS_BOSS_PATH = '/student/battle/class-boss';
export const CLASS_BOSS_QUERY_KEY = ['classBoss'] as const;
export const getClassBoss = async (): Promise<ClassBoss> => api.get(CLASS_BOSS_PATH);
export const claimClassBoss = async (week: 'this' | 'last'): Promise<{ food: number; xp: number; leveled_up?: boolean }> =>
  api.post(`${CLASS_BOSS_PATH}/claim`, null, { params: { week } });
