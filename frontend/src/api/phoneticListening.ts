/**
 * 音标听力 API(2026-11-03)
 *
 * ⚠️ 题目列表不给单词、音标、释义 —— 听力就是听出来写。读音按题目 id 取
 * (/items/{id}/tts 或老师录音 /items/{id}/audio),单词不出现在网址里,开发者工具里也看不到答案。
 * 规则真源 backend/app/services/phonetic_listening.py。
 */
import api from './client';
import { API_BASE_URL } from '../config/env';

const S = '/phonetic-practice/listening';
const T = '/teacher/phonetic-books/listening';

// ---------------------------------------------------------------- 学生

export interface ListeningSetBrief {
  id: number;
  title: string;
  item_count: number;
  done_count: number;
  right_count: number;
}

export interface ListeningBookGroup {
  id: number;
  name: string;
  sets: ListeningSetBrief[];
}

export interface ListeningItemQ {
  id: number;
  hint?: string | null;
  slot_count: number;
  stress_at: number[];
  has_audio: boolean;
}

export interface ListeningSetQ {
  id: number;
  title: string;
  book_name: string;
  items: ListeningItemQ[];
}

export interface ListeningCheckResult {
  all_correct: boolean;
  word_ok: boolean;
  phonetic_ok: boolean;
  per_slot: (boolean | null)[];
  wrong_indexes: number[];
  finished: boolean;
  next_blanks?: number[];
  prefill?: (string | null)[];
  answer?: { word: string; phonetic_tokens: string[]; phonetic: string; meaning?: string | null };
}

export const listListeningSets = (): Promise<ListeningBookGroup[]> => api.get(`${S}/sets`);
export const getListeningSet = (id: number | string): Promise<ListeningSetQ> => api.get(`${S}/sets/${id}`);
export const checkListening = (body: {
  item_id: number; pass_number: number; word: string; phonetic: (string | null)[];
  give_up?: boolean; duration_ms?: number;
}): Promise<ListeningCheckResult> => api.post(`${S}/check`, body);

/** 这一题的读音地址: 老师录了就放老师的,否则系统读。都要带登录(用 fetch + Authorization 拉成 blob) */
export const listeningAudioUrl = (it: { id: number; has_audio: boolean }, teacher = false) =>
  `${API_BASE_URL}${teacher ? T : S}/items/${it.id}/${it.has_audio ? 'audio' : 'tts'}`;

// ---------------------------------------------------------------- 老师

export interface TeacherListeningBook {
  id: number;
  name: string;
  volume?: string | null;
  is_preset: boolean;
  can_edit: boolean;
  set_count: number;
}

export interface TeacherListeningItem {
  id?: number;
  word: string;
  phonetic: string;
  meaning?: string | null;
  hint?: string | null;
  tts?: string | null;
  has_audio?: boolean;
}

export interface TeacherListeningSet {
  id: number;
  book_id: number;
  title: string;
  can_edit: boolean;
  items: TeacherListeningItem[];
}

export interface ListeningResults {
  items: { id: number; word: string; phonetic?: string }[];
  students: {
    id: number; name: string; done: number; first_right: number;
    cells: Record<string, { first_word: boolean; first_phonetic: boolean; first_ok: boolean;
      wrote?: string | null; done: boolean; ok: boolean }>;
  }[];
}

export const teacherListeningBooks = (): Promise<TeacherListeningBook[]> => api.get(`${T}/books`);
export const teacherListeningSets = (bookId: number): Promise<{
  can_edit: boolean;
  sets: { id: number; title: string; item_count: number; audio_count: number; can_edit: boolean; is_platform: boolean }[];
}> => api.get(`${T}/books/${bookId}/sets`);
export const teacherGetListeningSet = (id: number): Promise<TeacherListeningSet> => api.get(`${T}/sets/${id}`);
export const createListeningSet = (bookId: number, body: { title: string; items: TeacherListeningItem[] }):
  Promise<TeacherListeningSet> => api.post(`${T}/books/${bookId}/sets`, body);
export const updateListeningSet = (id: number, body: { title: string; items: TeacherListeningItem[] }):
  Promise<TeacherListeningSet> => api.put(`${T}/sets/${id}`, body);
export const deleteListeningSet = (id: number) => api.delete(`${T}/sets/${id}`);
export const uploadListeningAudio = (itemId: number, blob: Blob, name = 'audio') => {
  const fd = new FormData();
  fd.append('audio', blob, name);
  return api.post(`${T}/items/${itemId}/audio`, fd);
};
export const deleteListeningAudio = (itemId: number) => api.delete(`${T}/items/${itemId}/audio`);
export const listeningResults = (id: number): Promise<ListeningResults> => api.get(`${T}/sets/${id}/results`);

/** 带登录拉音频成 blob 地址(录音和 tts 接口都要鉴权,<audio src> 带不上 Authorization) */
export async function fetchAuthedAudio(url: string): Promise<string> {
  const token = localStorage.getItem('access_token');
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    let msg = '读音拉不下来,点一下再试';
    try {
      const j = await res.json();
      const d = j?.detail;
      msg = typeof d === 'string' ? d : d?.message || msg;
    } catch { /* 不是 JSON 就用默认那句 */ }
    throw new Error(msg);
  }
  return URL.createObjectURL(await res.blob());
}
