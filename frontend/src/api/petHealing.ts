import api from './client';

// ========================================
// 宠物治疗系统 API
// ========================================

export interface HealingStatus {
  pet_id: number;
  pet_name: string;
  current_hp: number;
  max_hp: number;
  hp_percent: number;
  is_injured: boolean;
  questions_needed: number;
  heal_per_question: number;
}

export interface HealingWord {
  id: number;
  word: string;
  phonetic: string | null;
  meaning: string;
  part_of_speech: string | null;
}

export interface HealResponse {
  healed: number;
  current_hp: number;
  max_hp: number;
  is_healthy: boolean;
  hp_percent: number;
}

export const getHealingStatus = async (): Promise<HealingStatus> => {
  return api.get('/student/pet/healing-status');
};

export const healPet = async (wordId: number, isCorrect: boolean): Promise<HealResponse> => {
  return api.post('/student/pet/heal', null, {
    params: { word_id: wordId, is_correct: isCorrect },
  });
};

export const getHealingWords = async (limit = 10): Promise<HealingWord[]> => {
  return api.get('/student/pet/healing-words', { params: { limit } });
};
