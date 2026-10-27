/**
 * AI 学习助手(2026-10-26)。规则见后端 services/tutor.py
 *
 * 提问走 fetch 读流(SSE): 回答一段段推过来,收到就显示,孩子不用干等。
 * axios 读不了流,所以 ask() 自己带 token、自己处理 401。
 */
import client from './client';
import { API_BASE_URL } from '../config/env';
import { onUnauthorized } from './_authInterceptors';

/** 单词练习卡的一个词: 不带拼写和音标(答案只在服务器),听发音按 word_id 取;letters = 几个字母。
 * 10-27 之前出的旧卡没有 quiz_id,带 word(网页当场判) */
export interface PracticeItem { word_id?: number; meaning: string | null; letters?: number; word?: string; phonetic?: string | null }
/** 语法 / 句子小题(services/tutor_quiz): 发下来的没有答案 */
export type QuizItem =
  | { type: 'choice'; question: string; options: string[] }
  | { type: 'fill'; question: string }
  | { type: 'order'; question: string; tokens: string[] };
export interface QuizItemResult { ok: boolean; your: string; answer: string; explain?: string | null }
/** 交过的练习(刷新对话后带着第一次的作答和结果) */
export interface QuizResult {
  answers: Array<string | number | null>;
  results: QuizItemResult[];
  score: number;
  total: number;
  /** 已经让小鹰老师点评过 */
  feedback_done: boolean;
  /** 点评这份不扣次数 */
  free: boolean;
}
export type TutorCard =
  | { type: 'practice'; mode: 'listen' | 'meaning'; items: PracticeItem[]; quiz_id?: number; result?: QuizResult; key?: string[] }
  | { type: 'quiz'; quiz_id: number; topic: string | null; items: QuizItem[]; result?: QuizResult; key?: string[] }
  | { type: 'link'; target: 'review' | 'homework' | 'mistakes'; label: string; route: string }
  /** 单词记忆图(services/word_picture): status 是画图那一刻的,前端按 pic_id 轮询拿最新的 */
  | { type: 'picture'; pic_id: number; word: string; word_id?: number; status: PictureStatus; url: string | null };

export type PictureStatus = 'pending' | 'ready' | 'failed' | 'removed';
export interface WordPictureOut {
  pic_id: number;
  word: string;
  meaning: string | null;
  status: PictureStatus;
  url: string | null;
  error: string | null;
}

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
  /** 学习卡一共带来几次(已含在 extra 里) */
  card_times: number;
  /** 同一道题的追问: 付过次数的那问之后 followup_minutes 分钟内,最多 followup_free 次不另算 */
  followup_free: number;
  followup_minutes: number;
  /** 能不能画记忆图;画一张新图用掉几次 */
  picture_enabled: boolean;
  picture_cost: number;
  max_text: number;
}

/** 这段对话现在还能免费追问几次;null = 下一问照常算次数 */
export type TutorFollowup = { left: number; until: string } | null;

export interface TutorConversationItem { id: number; title: string; message_count: number; updated_at: string | null }

export const getTutorStatus = () => client.get<TutorStatus>('/student/tutor/status');
export const listConversations = () => client.get<{ items: TutorConversationItem[] }>('/student/tutor/conversations');
export const getConversation = (id: number) =>
  client.get<{ id: number; title: string; messages: TutorMessage[]; followup: TutorFollowup }>(`/student/tutor/conversations/${id}`);

export const requestMoreTutor = () => client.post<{ ok: boolean }>('/student/tutor/request-more');
// ---- 单词记忆图: 一个词全平台一张,画过的免费看;第一次画扣 picture_cost 次
export const getWordPicture = (wordId: number) =>
  client.get<{ word: string; exists: boolean; picture: WordPictureOut | null; enabled: boolean; cost: number }>(
    `/student/tutor/pictures/word/${wordId}`);
export const requestWordPicture = (wordId: number) =>
  client.post<WordPictureOut & { charged: number }>('/student/tutor/pictures', { word_id: wordId });
export const getPicture = (picId: number) => client.get<WordPictureOut>(`/student/tutor/pictures/${picId}`);

/** 交聊天里的练习: 服务器判分。feedback=true 时接着带 quiz_id 问一句,请小鹰老师点评(不扣次数) */
export const submitQuiz = (quizId: number, answers: Array<string | number | null>) =>
  client.post<{ quiz_id: number; results: QuizItemResult[]; score: number; total: number; first: boolean; feedback: boolean; free: boolean }>(
    `/student/tutor/quizzes/${quizId}/submit`, { answers });

export const stopTutor = (userMessageId: number) =>
  client.post<{ ok: boolean }>('/student/tutor/stop', { user_message_id: userMessageId });

export type TutorEvent =
  | { type: 'meta'; conversation_id: number; user_message_id: number; left: number; mode: TutorMode; cost: number }
  | { type: 'delta'; text: string }
  /** 模型开始思考了(思考内容不下发,里面常直接写着答案) */
  | { type: 'thinking' }
  | { type: 'status'; text: string }
  | { type: 'card'; card: TutorCard }
  | { type: 'done'; message_id: number; stopped?: boolean; refunded?: boolean; followup?: TutorFollowup }
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
  params: { text: string; conversationId?: number | null; image?: Blob | null; mode?: TutorMode; quizId?: number },
  onEvent: (ev: TutorEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const form = new FormData();
  form.append('text', params.text);
  form.append('mode', params.mode || 'fast');
  if (params.conversationId) form.append('conversation_id', String(params.conversationId));
  if (params.image) form.append('image', params.image, 'question.jpg');
  if (params.quizId) form.append('quiz_id', String(params.quizId));
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
  /** 助手看到的这个孩子的学情摘要(一行一条);没问过为 null */
  profile: string[] | null;
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
/** 机构学习助手次数池(加盟机构老师加次数从这里扣);直营为 null */
export interface TutorPool { total: number; used: number; left: number; price: number; min_buy: number }
export const getTutorStudents = () =>
  client.get<{
    free_total: number; deep_cost: number; enabled: boolean; requested: number; items: TutorQuotaStudent[];
    pool: TutorPool | null; card_times: number;
  }>('/teacher/tutor/students');
export const grantTutor = (studentIds: number[], add: number) =>
  client.post<{ ok: boolean; count: number; added: number; capped: number; pool: TutorPool | null }>(
    '/teacher/tutor/grant', { student_ids: studentIds, add });
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
  scope: 'off' | 'hq' | 'pack' | 'all';
  free_total: number;
  deep_cost: number;
  provider: null | {
    enabled: boolean; base_url: string | null; model: string | null; fallback_model: string | null;
    /** null = 深度思考关着 */
    deep_model: string | null; deep_fallback_model: string | null;
    api_key_masked: string; key_ok: boolean;
  };
  usage: TutorUsageDay[];
  picture: {
    enabled: boolean;
    daily_limit: number;
    cost: number;
    counts: Partial<Record<PictureStatus, number>>;
    provider: null | { model: string | null; base_url: string | null; quality: 'low' | 'medium' | 'high';
      api_key_masked: string; key_ok: boolean };
  };
}
export const getTutorAdmin = () => client.get<TutorAdminState>('/admin/tutor');
export const saveTutorAdmin = (body: {
  scope: TutorAdminState['scope']; free_total: number; deep_cost: number; model?: string; fallback_model?: string;
  deep_model?: string; deep_fallback_model?: string; base_url?: string; api_key?: string;
  picture_enabled?: boolean; picture_daily_limit?: number; picture_model?: string;
  picture_quality?: 'low' | 'medium' | 'high'; picture_base_url?: string; picture_api_key?: string;
}) => client.put<TutorAdminState>('/admin/tutor', body);
export const getAdminPictures = () =>
  client.get<{ items: Array<WordPictureOut & { model: string | null; created_at: string | null }> }>('/admin/tutor/pictures');
export const removeAdminPicture = (picId: number) => client.delete<{ ok: boolean }>(`/admin/tutor/pictures/${picId}`);
export const testTutorAdmin = () =>
  client.post<{ results: Array<{ model: string; mode: TutorMode; ok: boolean; message: string; ms: number }> }>(
    '/admin/tutor/test', undefined, { timeout: 70000 });

// ---- 平台: 各机构的学习助手次数池(合同第三条第 10 款: 机构按次进货)
export interface TutorPoolDetail extends TutorPool {
  org_id: number;
  org_name: string;
  ledger: Array<{ id: number; times: number; source: 'purchase' | 'adjust'; note: string | null; created_at: string | null }>;
}
export const getTutorPools = () =>
  client.get<{ price: number; min_buy: number; card_times: number; items: Record<string, { total: number; used: number; left: number }> }>(
    '/admin/tutor/pools');
export const getTutorPool = (orgId: number) => client.get<TutorPoolDetail>(`/admin/tutor/pools/${orgId}`);
export const creditTutorPool = (orgId: number, times: number, note?: string) =>
  client.post<TutorPoolDetail>(`/admin/tutor/pools/${orgId}`, { times, note });
