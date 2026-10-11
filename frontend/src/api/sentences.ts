import client from './client';
import { submitReliably } from './submitQueue';

export interface SentenceBook {
  id: number;
  name: string;
  description: string | null;
  grade_level: string | null;
  volume: string | null;
  cover_color: string;
  cover_url: string | null;
  is_public: boolean;
  unit_count: number;
  sentence_count: number;
}

export interface SentenceUnit {
  id: number;
  book_id: number;
  unit_number: number;
  name: string;
  description: string | null;
  order_index: number;
  sentence_count: number;
}

export interface Sentence {
  id: number;
  unit_id: number;
  order_index: number;
  english: string;
  /** 带 # 的高频词标记原文(I #like# apples.),没标为 null */
  english_marked?: string | null;
  chinese: string;
  phonetic: string | null;
  tts_text: string | null;
  difficulty: number;
  topic: string | null;
  grammar_focus: string | null;
}

export interface BulkImportResult {
  added: number;
  skipped: number;
  errors: string[];
}

// Books
export const listSentenceBooks = () => client.get<SentenceBook[]>('/sentences/books');
export const createSentenceBook = (body: Partial<SentenceBook>) => client.post<SentenceBook>('/sentences/books', body);
export const updateSentenceBook = (id: number, body: Partial<SentenceBook>) =>
  client.patch<SentenceBook>(`/sentences/books/${id}`, body);
export const deleteSentenceBook = (id: number) => client.delete(`/sentences/books/${id}`);

// Units
export const listSentenceUnits = (bookId: number) =>
  client.get<SentenceUnit[]>(`/sentences/books/${bookId}/units`);
export const createSentenceUnit = (bookId: number, body: { name: string; description?: string }) =>
  client.post<SentenceUnit>(`/sentences/books/${bookId}/units`, body);
export const updateSentenceUnit = (unitId: number, body: { name?: string; description?: string }) =>
  client.patch<SentenceUnit>(`/sentences/units/${unitId}`, body);
export const deleteSentenceUnit = (unitId: number) => client.delete(`/sentences/units/${unitId}`);

// Sentences
export const listSentences = (unitId: number) =>
  client.get<Sentence[]>(`/sentences/units/${unitId}/sentences`);
export const createSentence = (unitId: number, body: Partial<Sentence>) =>
  client.post<Sentence>(`/sentences/units/${unitId}/sentences`, body);
export const updateSentence = (id: number, body: Partial<Sentence>) =>
  client.patch<Sentence>(`/sentences/sentences/${id}`, body);
export const deleteSentence = (id: number) => client.delete(`/sentences/sentences/${id}`);

export const bulkImportSentences = async (unitId: number, file: File): Promise<BulkImportResult> => {
  const fd = new FormData();
  fd.append('file', file);
  return client.post<BulkImportResult>(`/sentences/units/${unitId}/bulk-import`, fd);
};

// ===================== 学生端分组学习(2026-10-11) =====================
// 流程: 听读 → 连词成句 → 开口背 → 默写 → 过关检测 → 单元复习(pages/SentenceLearning.tsx)

export interface LearnSentence {
  id: number;
  english: string;
  /** 带 # 的高频词标记,显示时上色;没标为 null */
  marked: string | null;
  chinese: string;
  tts_text: string | null;
  /** 以破折号开头的对话行;同一段对话服务端已放进同一组 */
  is_dialogue: boolean;
  /** 过关检测「关键词填空」挖的词(功能词和缩写不挖),可能为空 */
  key_word: string | null;
}

export interface LearnUnit {
  unit_id: number;
  unit_name: string;
  book_name: string;
  /** 服务端切好的组(按句长 + 对话不拆),前端别自己再切 */
  groups: LearnSentence[][];
  /** 断点: 已过关的组数 */
  groups_passed: number;
  completed: boolean;
}

export type SentenceStage = 'arrange' | 'dictation' | 'exam';

export const getLearnUnit = (unitId: number) =>
  client.get<LearnUnit>(`/student/sentences/units/${unitId}/learn`);

/** 首答上报(走可靠队列,断网关页下次补交;幂等键防重复) */
export const submitSentenceRecords = (payload: {
  unit_id: number;
  answers: { sentence_id: number; stage: SentenceStage; is_correct: boolean; answer?: string }[];
  session_seconds: number;
}) => submitReliably('/student/sentences/records', payload);

export const submitSentenceGroupPass = (unitId: number, groupIndex: number, score: number) =>
  submitReliably<{ groups_passed: number; total_groups: number; unit_completed: boolean }>(
    `/student/sentences/units/${unitId}/group-pass`, { group_index: groupIndex, score },
  );


/** 开口背录音进后台转写队列。孩子不等结果、失败静默(只给老师参考,不影响学习) */
export const uploadSentenceSpeech = (unitId: number, sentenceId: number, blob: Blob) => {
  const fd = new FormData();
  fd.append('audio', blob, 'speech');
  fd.append('unit_id', String(unitId));
  fd.append('sentence_id', String(sentenceId));
  return client.post('/student/sentences/speech', fd);
};

export interface SentenceSpeechItem {
  id: number;
  unit_name: string;
  english: string;
  chinese: string;
  status: 'pending' | 'done' | 'failed';
  transcript: string | null;
  missed_words: string[];
  hit_ratio: number | null;
  passed: boolean | null;
  created_at: string | null;
}

export const getStudentSentenceSpeech = (studentId: number) =>
  client.get<{ items: SentenceSpeechItem[]; summary: { total: number; done: number; passed: number; pending: number } }>(
    `/teacher/students/${studentId}/sentence-speech`,
  );
