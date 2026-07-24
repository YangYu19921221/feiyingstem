import api from './client';

// ========================================
// 宠物养成系统 API
// ========================================

export interface Pet {
  id: number;
  user_id: number;
  name: string;
  species: string;
  level: number;
  experience: number;
  happiness: number;
  hunger: number;
  evolution_stage: number;
  xp_to_next_level: number;
  xp_per_feed: number;
  evolution_stage_name: string;
  food_balance: number;
  current_hp: number;
  is_injured: boolean;
  is_active: boolean;
  last_fed_at: string | null;
  last_interaction_at: string | null;
  created_at: string;
}

export interface PetFeedResponse {
  message: string;
  pet: Pet;
  leveled_up: boolean;
  evolved: boolean;
  new_level: number | null;
  new_stage: number | null;
}

export interface PetEvent {
  id: number;
  pet_id: number;
  event_type: string;
  detail: string | null;
  created_at: string;
}

export interface CreatePetRequest {
  name: string;
  species: string;
}

export interface SwitchPetRequest {
  pet_id: number;
}

export interface PetCollection {
  pets: Pet[];
  active_pet_id: number | null;
  learned_words: number;
  unlocked_slots: number;
  used_slots: number;
  max_slots: number;
  words_per_slot: number;
  next_slot_words: number | null;
  recovery_goal_words: number | null;
  recovery_words_remaining: number;
}

export interface EarnFoodRequest {
  score: number;
  total: number;
  mode: 'classify' | 'quiz' | 'fillblank' | 'spelling';
}

export interface EarnFoodResponse {
  food_earned: number;
  food_balance: number;
  is_first_today: boolean;
  breakdown: {
    base: number;
    accuracy_bonus: number;
    mode_bonus: number;
    daily_bonus: number;
  };
}

export const getMyPet = async (): Promise<Pet | null> => {
  try {
    return await api.get('/student/pet');
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) return null;
    throw err;
  }
};

export const createPet = async (data: CreatePetRequest): Promise<Pet> => {
  return api.post('/student/pet', data);
};

export const getPetCollection = async (): Promise<PetCollection> => {
  return api.get('/student/pet/collection');
};

export const switchPet = async (data: SwitchPetRequest): Promise<Pet> => {
  return api.post('/student/pet/switch', data);
};

export const feedPet = async (): Promise<PetFeedResponse> => {
  return api.post('/student/pet/feed');
};

export const earnFood = async (data: EarnFoodRequest): Promise<EarnFoodResponse> => {
  return api.post('/student/pet/earn-food', data);
};

export const getPetEvents = async (): Promise<PetEvent[]> => {
  return api.get('/student/pet/events');
};

// ========== 排行榜 ==========

export interface PetLeaderboardEntry {
  rank: number;
  username: string;
  pet_name: string;
  species: string;
  level: number;
  evolution_stage: number;
  evolution_stage_name: string;
}

export interface PetLeaderboardResponse {
  entries: PetLeaderboardEntry[];
  my_rank: number | null;
}

export const getPetLeaderboard = async (): Promise<PetLeaderboardResponse> => {
  return api.get('/student/pet/leaderboard');
};
