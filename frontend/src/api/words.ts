import api from './client';

export interface WordDefinition {
  id: number;
  part_of_speech: string;
  meaning: string;  // 后端使用的字段名
  example_sentence?: string;  // 后端使用的字段名
  example_translation?: string;
  is_primary: boolean;
}

export interface Word {
  id: number;
  word: string;
  phonetic?: string;
  difficulty: number;
  grade_level?: string;
  audio_url?: string;
  image_url?: string;
  definitions: WordDefinition[];
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface CreateWordDefinition {
  part_of_speech?: string;
  meaning: string;
  example_sentence?: string;
  example_translation?: string;
  is_primary?: boolean;
}

export interface CreateWordData {
  word: string;
  phonetic?: string;
  difficulty?: number;
  grade_level?: string;
  audio_url?: string;
  image_url?: string;
  definitions: CreateWordDefinition[];
  tags?: string[];
}

// 获取单词列表
export const getWords = async (params?: {
  skip?: number;
  limit?: number;
  difficulty?: number;
  grade_level?: string;
  tag?: string;
}) => {
  return api.get<Word[]>('/words/', { params });
};

// 获取单个单词详情
export const getWord = async (wordId: number) => {
  return api.get<Word>(`/words/${wordId}`);
};

// 创建新单词
export const createWord = async (data: CreateWordData) => {
  return api.post<Word>('/words/', data);
};

// 更新单词
export const updateWord = async (wordId: number, data: Partial<CreateWordData>) => {
  return api.put<Word>(`/words/${wordId}`, data);
};

// 删除单词
export const deleteWord = async (wordId: number) => {
  return api.delete(`/words/${wordId}`);
};

// 搜索单词
export const searchWords = async (query: string) => {
  return api.get<Word[]>('/words/search/', { params: { q: query } });
};

// 获取随机单词(用于学习)
export const getRandomWords = async (count: number = 10, difficulty?: number) => {
  return api.get<Word[]>('/words/random/', {
    params: { count, difficulty }
  });
};
