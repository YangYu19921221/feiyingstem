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
  | { type: 'picture'; pic_id: number; word: string; word_id?: number; status: PictureStatus; url: string | null }
  /** 孩子发的文件(services/tutor_files): 只有文件名和类型,内容不存 */
  | { type: 'file'; name: string; kind: 'pdf' | 'docx' | 'doc' | 'txt'; pages: number | null; scanned: boolean; truncated: boolean }
  /** 教师端出的练习卷(services/teacher_tutor.make_worksheet): 带答案,给老师下载打印 */
  | { type: 'worksheet'; title: string; topic: string | null; items: WorksheetItem[]; students: string[] };

export type WorksheetItem =
  | { type: 'choice'; question: string; options: string[]; answer: string; explain?: string | null }
  | { type: 'fill'; question: string; answer: string; also?: string[]; explain?: string | null }
  | { type: 'order'; question: string; tokens: string[]; answer: string; explain?: string | null };

/** 能传的文件(和后端 tutor_files 同一份) */
// .doc 也放进来: 选到了当场提示另存(灰着选不了,孩子不知道为什么)
export const TUTOR_FILE_ACCEPT = '.pdf,.doc,.docx,.txt';
export const TUTOR_FILE_MAX_MB = 20;

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
  /** 「按住说话」能不能用(服务器装了语音识别) */
  voice_enabled?: boolean;
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
  /** 首页「考考你」(services/tutor_notes): 今天到期该回头考的一个点;今天的免费那次用过了 / 没有到期的为 null */
  review?: TutorReview | null;
}

export interface TutorReview { note_id: number; topic: string; kind: 'point' | 'word'; since: '昨天' | '上次' }

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
  params: { text: string; conversationId?: number | null; image?: Blob | null; file?: File | null; mode?: TutorMode; quizId?: number;
    /** 次数用完了,点「想说说心里话」进来的(services/tutor_safety) */
    care?: boolean;
    /** 首页「考考你」(services/tutor_notes): 考哪个点由服务器从笔记里拼 */
    reviewNoteId?: number },
  onEvent: (ev: TutorEvent) => void,
  signal?: AbortSignal,
  /** 教师端问自己的小鹰老师: /teacher/tutor/me/ask */
  path = '/student/tutor/ask',
): Promise<void> {
  const form = new FormData();
  form.append('text', params.text);
  form.append('mode', params.mode || 'fast');
  if (params.conversationId) form.append('conversation_id', String(params.conversationId));
  if (params.image) form.append('image', params.image, 'question.jpg');
  if (params.file) form.append('file', params.file, params.file.name);
  if (params.quizId) form.append('quiz_id', String(params.quizId));
  if (params.care) form.append('care', '1');
  if (params.reviewNoteId) form.append('review_note_id', String(params.reviewNoteId));
  const token = localStorage.getItem('access_token');
  const res = await fetch(`${API_BASE_URL}${path}`, {
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
  items: Array<{
    id: number; title: string; updated_at: string | null; messages: TutorMessage[];
    /** 孩子删了(老师 30 天内还看得到,services/tutor_history) */
    deleted?: boolean;
    starred?: boolean;
  }>;
  /** 小鹰老师按什么讲这个孩子(services/tutor_level) */
  prefs?: import('./tutorHistory').TutorLevel | null;
  /** 这个孩子说到难过 / 被欺负的提醒(services/tutor_safety),新的在前 */
  alerts?: TutorAlert[];
}
export const getStudentTutorLog = (studentId: number) =>
  client.get<TeacherTutorLog>(`/teacher/students/${studentId}/tutor`);

export interface AlertCounts { open: number; urgent: number }
export const getTutorAvailable = () =>
  client.get<{ enabled: boolean; requested: number; alerts?: AlertCounts;
    /** 要请老师当面讲的点(services/tutor_notes「交给老师」) */
    handoffs?: number;
    /** 老师自己能不能用教师端小鹰老师 */
    me_enabled?: boolean }>('/teacher/tutor/available');

// ---- 要请老师当面讲的点(services/tutor_notes「交给老师」)
export interface TutorHandoff {
  note_id: number; student_id: number; student_name: string; class_name: string;
  topic: string; kind: 'point' | 'word'; detail: string | null;
  times_wrong: number; times_right: number;
  /** false = 讲过了、之后没再错(只在 all=1 时出现) */
  pending: boolean;
  updated_at: string | null;
  /** 讲过以后又错了: 上次讲的记录 */
  handled: null | { at: string; by: string; note: string; wrong_then: number };
}
export const getTutorHandoffs = (all = false) =>
  client.get<{ items: TutorHandoff[]; pending: number; threshold: number }>('/teacher/tutor/handoffs', { params: { all: all || undefined } });
export const handleTutorHandoff = (noteId: number, note: string) =>
  client.post<{ ok: boolean }>(`/teacher/tutor/handoffs/${noteId}`, { note });

// ---- 教师端: 老师自己问小鹰老师(services/teacher_tutor)
export interface TeacherTutorStatus {
  enabled: boolean; reason: string;
  /** 每位老师每月几次;month = 北京时间 YYYY-MM */
  monthly: number; month: string; month_used: number; month_left: number;
  /** 加盟机构: 每问一次从机构次数池扣 */
  uses_pool: boolean; pool_left: number | null; price: number;
  /** 这次能问几次(本月剩的和池子剩的取小) */
  left: number;
  /** 问不了时是哪个不够: month 本月的用完了 / pool 机构池没了 */
  limit_by: 'month' | 'pool' | null;
  deep_enabled: boolean; deep_cost: number; max_text: number; voice_enabled: boolean;
}
export interface RosterItem { code: string; id: number; name: string; class_name: string }
export const getTeacherTutorStatus = () => client.get<TeacherTutorStatus>('/teacher/tutor/me/status');
export const getTeacherTutorRoster = () => client.get<{ items: RosterItem[] }>('/teacher/tutor/me/roster');
export const getTeacherConversation = (id: number) =>
  client.get<{ id: number; title: string; messages: TutorMessage[]; followup: null }>(`/teacher/tutor/me/conversations/${id}`);
export const stopTeacherTutor = (userMessageId: number) =>
  client.post<{ ok: boolean }>('/teacher/tutor/me/stop', { user_message_id: userMessageId });
export const TEACHER_ASK_PATH = '/teacher/tutor/me/ask';
export const uploadTeacherVoice = (blob: Blob) => {
  const form = new FormData();
  const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
  form.append('audio', blob, `voice.${ext}`);
  return client.post<{ id: number; status: string }>('/teacher/tutor/me/voice', form, { timeout: 30000 });
};
export const getTeacherVoice = (id: number) =>
  client.get<{ id: number; status: 'pending' | 'done' | 'failed'; text: string }>(`/teacher/tutor/me/voice/${id}`);

// ---- 需要关心的孩子(services/tutor_safety)
export interface TutorAlert {
  id: number; student_id: number; student_name: string | null; class_name: string | null; org_name: string | null;
  conversation_id: number | null;
  /** urgent = 说到想伤害自己 / 不想活;concern = 被欺负、很难过 */
  level: 'urgent' | 'concern';
  source: string; matched: string | null; reason: string | null; excerpt: string | null;
  created_at: string | null; handled_at: string | null; handled_by_name: string | null; handled_note: string | null;
}
export type AlertStatus = 'open' | 'done' | 'all';
export const getTeacherAlerts = (status: AlertStatus = 'open') =>
  client.get<{ items: TutorAlert[]; counts: AlertCounts }>('/teacher/tutor/alerts', { params: { status } });
export const handleTeacherAlert = (id: number, note: string) =>
  client.post<TutorAlert>(`/teacher/tutor/alerts/${id}/handle`, { note });
export const getAdminAlerts = (status: AlertStatus = 'open') =>
  client.get<{ items: TutorAlert[]; counts: AlertCounts }>('/admin/tutor/alerts', { params: { status } });
export const handleAdminAlert = (id: number, note: string) =>
  client.post<TutorAlert>(`/admin/tutor/alerts/${id}/handle`, { note });

// ---- 效果数据 / 全班汇总(services/tutor_insight)
export interface TutorEffect {
  /** 能比较的词数(之前之后都有正式计分题) */
  words: number;
  /** 小鹰老师笔记里一共记了几个词 */
  noted_words: number;
  before: number | null; after: number | null;
  /** 够 min_words 个词才下结论 */
  enough: boolean; min_words: number; before_days: number;
}
export interface TutorClassSummary {
  days: number;
  items: Array<{ id: number; name: string; class_name: string; questions: number; last_at: string | null;
    stuck: number; alerts: number; urgent: number }>;
  stuck_points: Array<{ topic: string; students: number; wrong: number }>;
  stuck_words: Array<{ topic: string; students: number; wrong: number }>;
  effect: TutorEffect;
  asked_students: number; questions: number;
}
export const getTutorSummary = (days = 7) => client.get<TutorClassSummary>('/teacher/tutor/summary', { params: { days } });
export const getAdminTutorEffect = () => client.get<TutorEffect>('/admin/tutor/effect');

// ---- 按住说话(services/tutor_voice)
export const uploadTutorVoice = (blob: Blob) => {
  const form = new FormData();
  const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
  form.append('audio', blob, `voice.${ext}`);
  return client.post<{ id: number; status: string }>('/student/tutor/voice', form, { timeout: 30000 });
};
export const getTutorVoice = (id: number) =>
  client.get<{ id: number; status: 'pending' | 'done' | 'failed'; text: string }>(`/student/tutor/voice/${id}`);

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
/** 机构次数池: purchased = 进货(收了钱)累计,gifted = 平台赠送累计 */
export interface TutorPool { total: number; used: number; left: number; price: number; min_buy: number; purchased?: number; gifted?: number }
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
  /** 教师端小鹰老师(services/teacher_tutor): 开没开、每位老师每月几次、本月几位老师用了几次 */
  teacher: { enabled: boolean; monthly: number; month: string; teachers: number; used: number; price: number };
}
export const saveTeacherTutorAdmin = (body: { enabled: boolean; monthly: number }) =>
  client.put<TutorAdminState['teacher']>('/admin/tutor/teacher', body);
export const getTutorAdmin = () => client.get<TutorAdminState>('/admin/tutor');

/** 中转钱包 / Key 检查(services/tutor_relay_health) */
export type RelayStatus = 'ok' | 'low' | 'empty' | 'invalid' | 'unknown' | 'unset';
export interface RelayProbe { status: RelayStatus; balance: number | null; note: string }
export interface RelayHealth {
  checked_at: string; tutor: RelayProbe; picture: RelayProbe; warn_balance: number;
  recent: { minutes: number; answers: number; failed: number };
}
export const getTutorHealth = () => client.get<RelayHealth>('/admin/tutor/health');
export const checkTutorHealth = () => client.post<RelayHealth>('/admin/tutor/health/check', undefined, { timeout: 40000 });
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
  /** 其中老师自己问小鹰老师用掉的(教师端,10-29) */
  teacher_used?: number;
  ledger: Array<{ id: number; times: number; source: 'purchase' | 'gift' | 'adjust'; note: string | null; created_at: string | null }>;
}
export const getTutorPools = () =>
  client.get<{ price: number; min_buy: number; card_times: number; items: Record<string, { total: number; used: number; left: number }> }>(
    '/admin/tutor/pools');
export const getTutorPool = (orgId: number) => client.get<TutorPoolDetail>(`/admin/tutor/pools/${orgId}`);
/** source: purchase = 机构付了钱(记金额)/ gift = 平台赠送(不收费、不受起订量)。times 为负 = 扣回 */
export const creditTutorPool = (orgId: number, times: number, note?: string, source: 'purchase' | 'gift' = 'purchase') =>
  client.post<TutorPoolDetail>(`/admin/tutor/pools/${orgId}`, { times, note, source });

/** 平台总览: 每个机构开没开(open 是原因,null = 没开)、次数池、学生数、问过的人数 */
export interface TutorOrgRow {
  id: number; name: string; status: string; card_plan: string;
  open: string | null; uses_pool: boolean; pool: TutorPool | null;
  free_per_student: number; students: number; asked_students: number;
}
export const getTutorOrgs = () =>
  client.get<{ scope: TutorAdminState['scope']; price: number; min_buy: number; card_times: number; items: TutorOrgRow[] }>(
    '/admin/tutor/orgs');
