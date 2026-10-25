/**
 * 例句跟读(2026-10-24)。规则见后端 services/read_aloud.py
 *
 * 孩子看例句 → 听原声 → 跟读 → 对比 → 下一句。当场只判「开口说够了」,对错只给老师看。
 * 录音保留 14 天,本班老师能回放、标「读对了 / 没读对」。不发金币、不进掌握度。
 */
import client from './client';

export interface ReadAloudItem {
  word_id: number;
  definition_id: number;
  word: string;
  sentence: string;
  translation: string;
}

export interface ReadAloudRound {
  unit_id: number;
  unit_name: string;
  round_size: number;
  keep_days: number;
  items: ReadAloudItem[];
}

export const getReadAloudRound = (unitId: number, assignmentId?: number | null) =>
  client.get(`/student/units/${unitId}/read-aloud`, {
    params: assignmentId ? { assignment_id: assignmentId } : undefined,
  }) as unknown as Promise<ReadAloudRound>;

/** 一句的录音进后台转写队列。孩子不等结果,失败调用方静默 */
export const uploadReadAloud = (unitId: number, wordId: number, blob: Blob, assignmentId?: number | null) => {
  const fd = new FormData();
  fd.append('audio', blob, 'read-aloud');
  fd.append('word_id', String(wordId));
  if (assignmentId) fd.append('assignment_id', String(assignmentId));
  return client.post(`/student/units/${unitId}/read-aloud`, fd);
};

export interface ReadAloudRecordingItem {
  id: number;
  unit_name: string;
  sentence: string;
  translation: string;
  status: 'pending' | 'done' | 'failed';
  transcript: string | null;
  missed_words: string[];
  passed: boolean | null;
  teacher_verdict: 'ok' | 'bad' | null;
  has_audio: boolean;
  created_at: string | null;
}

export interface ReadAloudStudentReport {
  keep_days: number;
  items: ReadAloudRecordingItem[];
  summary: { total: number; done: number; passed: number; pending: number; marked: number; agree: number };
}

export const getStudentReadAloud = (studentId: number) =>
  client.get(`/teacher/students/${studentId}/read-aloud`) as unknown as Promise<ReadAloudStudentReport>;

/** 回放录音: 带登录态取成 blob(不能直接塞 <audio src>,那样带不上 token) */
export async function fetchReadAloudAudio(id: number): Promise<string> {
  const blob = await client.get<Blob>(`/teacher/read-aloud/${id}/audio`, { responseType: 'blob', timeout: 30000 });
  return URL.createObjectURL(blob as unknown as Blob);
}

export const setReadAloudVerdict = (id: number, verdict: 'ok' | 'bad' | null) =>
  client.put(`/teacher/read-aloud/${id}/verdict`, { verdict });
