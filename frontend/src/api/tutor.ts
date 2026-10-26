/**
 * AI 学习助手(2026-10-26)。规则见后端 services/tutor.py
 *
 * 提问走 fetch 读流(SSE): 回答一段段推过来,收到就显示,孩子不用干等。
 * axios 读不了流,所以 ask() 自己带 token、自己处理 401。
 */
import client from './client';
import { API_BASE_URL } from '../config/env';
import { onUnauthorized } from './_authInterceptors';

export interface PracticeItem { word: string; meaning: string | null; phonetic: string | null }
export type TutorCard =
  | { type: 'practice'; mode: 'listen' | 'meaning'; items: PracticeItem[] }
  | { type: 'link'; target: 'review' | 'homework' | 'mistakes'; label: string; route: string };

export type TutorMode = 'fast' | 'deep';

export interface TutorMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  has_image: boolean;
  cards: TutorCard[];
  /** 这次没调通(只有错误,没有字) */
  failed: boolean;
  /** 孩子点了停止 */
  stopped: boolean;
  mode: TutorMode;
  created_at: string | null;
}

/** 次数: 每个学生一共送 free_total 次(不按天清零),老师加的在 extra,total = 两者之和 */
export interface TutorStatus {
  enabled: boolean;
  reason: string;
  used: number;
  extra: number;
  total: number;
  left: number;
  free_total: number;
  /** 已经点过「请老师加次数」、老师还没加 */
  requested: boolean;
  deep_enabled: boolean;
  /** 深度思考一次算几次 */
  deep_cost: number;
  max_text: number;
}

export interface TutorConversationItem { id: number; title: string; message_count: number; updated_at: string | null }

export const getTutorStatus = () => client.get<TutorStatus>('/student/tutor/status');
export const listConversations = () => client.get<{ items: TutorConversationItem[] }>('/student/tutor/conversations');
export const getConversation = (id: number) =>
  client.get<{ id: number; title: string; messages: TutorMessage[] }>(`/student/tutor/conversations/${id}`);

export const requestMoreTutor = () => client.post<{ ok: boolean }>('/student/tutor/request-more');
export const stopTutor = (userMessageId: number) =>
  client.post<{ ok: boolean }>('/student/tutor/stop', { user_message_id: userMessageId });

export type TutorEvent =
  | { type: 'meta'; conversation_id: number; user_message_id: number; left: number; mode: TutorMode; cost: number }
  | { type: 'delta'; text: string }
  /** 模型开始思考了(思考内容不下发,里面常直接写着答案) */
  | { type: 'thinking' }
  | { type: 'status'; text: string }
  | { type: 'card'; card: TutorCard }
  | { type: 'done'; message_id: number; stopped?: boolean; refunded?: boolean }
  | { type: 'error'; message: string; refunded?: boolean };

export class TutorAskError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** 提问。onEvent 每收到一个事件调一次;请求被拒(403/429/400)抛 TutorAskError */
export async function askTutor(
  params: { text: string; conversationId?: number | null; image?: Blob | null; mode?: TutorMode },
  onEvent: (ev: TutorEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const form = new FormData();
  form.append('text', params.text);
  form.append('mode', params.mode || 'fast');
  if (params.conversationId) form.append('conversation_id', String(params.conversationId));
  if (params.image) form.append('image', params.image, 'question.jpg');
  const token = localStorage.getItem('access_token');
  const res = await fetch(`${API_BASE_URL}/student/tutor/ask`, {
    method: 'POST',
    body: form,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal,
  });
  if (res.status === 401) {
    onUnauthorized();
    throw new TutorAskError('登录过期了,请重新登录', 401);
  }
  if (!res.ok || !res.body) {
    let msg = '小鹰老师现在连不上,过一会儿再试';
    try {
      const data = await res.json();
      if (typeof data?.detail === 'string') msg = data.detail;
    } catch { /* 不是 JSON(比如 nginx 的错误页) */ }
    throw new TutorAskError(msg, res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue;
        try {
          onEvent(JSON.parse(line.slice(5).trim()) as TutorEvent);
        } catch { /* 半截 JSON 不会出现(按空行切),保险起见忽略 */ }
      }
    }
  }
}

// ---- 老师: 本班学生的对话(只读)
export interface TeacherTutorLog {
  total_questions: number;
  items: Array<{ id: number; title: string; updated_at: string | null; messages: TutorMessage[] }>;
}
export const getStudentTutorLog = (studentId: number) =>
  client.get<TeacherTutorLog>(`/teacher/students/${studentId}/tutor`);

export const getTutorAvailable = () => client.get<{ enabled: boolean; requested: number }>('/teacher/tutor/available');

export interface TutorQuotaStudent {
  id: number;
  username: string;
  full_name: string;
  class_name: string;
  used: number;
  extra: number;
  total: number;
  left: number;
  questions: number;
  requested_at: string | null;
}
export const getTutorStudents = () =>
  client.get<{ free_total: number; deep_cost: number; enabled: boolean; requested: number; items: TutorQuotaStudent[] }>(
    '/teacher/tutor/students');
export const grantTutor = (studentIds: number[], add: number) =>
  client.post<{ ok: boolean; count: number }>('/teacher/tutor/grant', { student_ids: studentIds, add });
export const TUTOR_GRANT_MAX = 100;

// ---- 管理端
export interface TutorUsageDay {
  date: string;
  /** 这天提过问的学生数 */
  students: number;
  by_model: Array<{
    model: string; mode: TutorMode; answers: number; students: number; input_tokens: number; output_tokens: number;
    cache_read_tokens: number; cache_write_tokens: number; errors: number;
  }>;
}
export interface TutorAdminState {
  scope: 'off' | 'hq' | 'all';
  free_total: number;
  deep_cost: number;
  provider: null | {
    enabled: boolean; base_url: string | null; model: string | null; fallback_model: string | null;
    /** null = 深度思考关着 */
    deep_model: string | null; deep_fallback_model: string | null;
    api_key_masked: string; key_ok: boolean;
  };
  usage: TutorUsageDay[];
}
export const getTutorAdmin = () => client.get<TutorAdminState>('/admin/tutor');
export const saveTutorAdmin = (body: {
  scope: TutorAdminState['scope']; free_total: number; deep_cost: number; model?: string; fallback_model?: string;
  deep_model?: string; deep_fallback_model?: string; base_url?: string; api_key?: string;
}) => client.put<TutorAdminState>('/admin/tutor', body);
export const testTutorAdmin = () =>
  client.post<{ results: Array<{ model: string; mode: TutorMode; ok: boolean; message: string; ms: number }> }>(
    '/admin/tutor/test', undefined, { timeout: 70000 });
