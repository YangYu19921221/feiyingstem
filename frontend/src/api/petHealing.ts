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

/** 治疗题:服务端出题、服务端判分(2026-10-06 防多开刷血),不再下发正确答案 */
export interface HealingWord {
  question_id: number;
  id: number;
  word: string;
  phonetic: string | null;
  part_of_speech: string | null;
  options: string[];
}

export interface HealResponse {
  healed: number;
  is_correct: boolean;
  correct_answer: string;
  current_hp: number;
  max_hp: number;
  is_healthy: boolean;
  hp_percent: number;
}

export const getHealingStatus = async (): Promise<HealingStatus> => {
  return api.get('/student/pet/healing-status');
};

export const healPet = async (questionId: number, answer: string): Promise<HealResponse> => {
  return api.post('/student/pet/heal', { question_id: questionId, answer });
};

export const getHealingWords = async (limit = 10): Promise<HealingWord[]> => {
  return api.get('/student/pet/healing-words', { params: { limit } });
};
