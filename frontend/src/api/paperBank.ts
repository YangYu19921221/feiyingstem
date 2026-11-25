/**
 * 试卷库 + 专项小卷(2026-11-22)。规则见后端 services/paper_bank.py、services/paper_parse.py
 *
 * 老师传卷子 → 拆卷用的 Claude 拆成一道道题(单项选择、填空)→ 老师核对通过的进题库 →
 * 每个孩子每天一份小卷(按他的薄弱知识点和薄弱单词挑),网页上做、也能打印。
 * 发给孩子的题没有答案: 交了一题才告诉他对没对、错在哪。
 */
import client from './client';

// ---------------------------------------------------------------- 老师

export interface PaperStatus {
  enabled: boolean;
  reason: string;
  configured: boolean;
  is_admin: boolean;
  grades: string[];
  max_pages: number;
  max_mb: number;
  quiz_size: number;
}

export type DocStatus = 'queued' | 'parsing' | 'review' | 'failed' | 'deleted';

export interface PaperDoc {
  id: number;
  title: string;
  grade: string | null;
  note: string;
  file_name: string | null;
  file_kind: string | null;
  pages: number;
  pages_done: number;
  status: DocStatus;
  reason: string;
  skipped: Array<{ paper: string; name: string; reason: string }>;
  uploaded_by_name: string;
  created_at: string | null;
  finished_at: string | null;
  item_count: number;
  approved: number;
  pending: number;
  rejected: number;
  flagged: number;
  tokens: number;
}

export interface WrongNote { code: string; why: string }
export interface Trap { text: string; code: string; why: string }

export interface PaperItem {
  id: number;
  doc_id: number;
  paper_title: string;
  section: string;
  no: string;
  kind: 'mc' | 'fill';
  stem: string;
  options: string[];
  /** 选择题: "A";填空: ["likes"](一个空一项) */
  answer: string | string[];
  alts: string[][];
  base_word: string;
  explain: string;
  kps: string[];
  kp_names: string[];
  wrong: Record<string, WrongNote>;
  traps: Trap[];
  answer_source: 'page' | 'key' | 'ai' | 'edited';
  flags: string[];
  needs_image: boolean;
  status: 'pending' | 'approved' | 'rejected';
  page_no: number | null;
  tile_idx: number | null;
  y0: number | null;
  y1: number | null;
  test_words: string[];
  difficulty: number;
  n_answers: number;
  n_correct: number;
  grade: string | null;
}

export interface PaperDocDetail extends PaperDoc {
  items: PaperItem[];
  page_list: Array<{ page_no: number; status: string; tiles: number; text: boolean }>;
}

export interface KpPoint {
  id: string;
  name: string;
  kid: string;
  group: string;
  group_label: string;
  stage: string;
  prereq: string[];
  contrast: string | null;
  lessons: number[];
  diagnose: boolean;
  codes: Array<{ code: string; label: string }>;
}

export interface BankStats { total: number; by_kp: Record<string, number>; by_grade: Record<string, number> }

export const getPaperStatus = () => client.get<PaperStatus>('/teacher/paper-bank/status');
export const listPaperDocs = () => client.get<{ items: PaperDoc[] }>('/teacher/paper-bank/docs');

export function uploadPaperDoc(file: File, fields: { title: string; grade: string; note: string },
  onProgress?: (pct: number) => void) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('title', fields.title);
  fd.append('grade', fields.grade);
  fd.append('note', fields.note);
  return client.post<{ id: number }>('/teacher/paper-bank/docs', fd, {
    timeout: 300000,
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  });
}

export const getPaperDoc = (id: number) => client.get<PaperDocDetail>(`/teacher/paper-bank/docs/${id}`);
export const patchPaperDoc = (id: number, data: { title?: string; grade?: string }) =>
  client.patch<PaperDoc>(`/teacher/paper-bank/docs/${id}`, data);
export const retryPaperDoc = (id: number) => client.post<{ ok: boolean }>(`/teacher/paper-bank/docs/${id}/retry`);
export const approveCleanItems = (id: number) =>
  client.post<{ approved: number }>(`/teacher/paper-bank/docs/${id}/approve-clean`);
export const deletePaperDoc = (id: number) => client.delete<{ ok: boolean }>(`/teacher/paper-bank/docs/${id}`);
/** 整套改卷名(拆卷 AI 没认出卷名时叫「第 N 页开始的一套卷(卷名没认出来)」) */
export const renamePaper = (id: number, oldTitle: string, newTitle: string) =>
  client.post<{ renamed: number; paper_title: string }>(`/teacher/paper-bank/docs/${id}/rename-paper`,
    { old: oldTitle, new: newTitle });

export interface ItemEdit {
  stem?: string;
  options?: string[];
  answer?: string | string[];
  alts?: Array<string | string[]>;
  base_word?: string;
  explain?: string;
  kps?: string[];
  needs_image?: boolean;
  status?: 'pending' | 'approved' | 'rejected';
}
export const editPaperItem = (id: number, data: ItemEdit) => client.put<PaperItem>(`/teacher/paper-bank/items/${id}`, data);
export const getKpMap = () => client.get<{ points: KpPoint[]; bank: BankStats }>('/teacher/paper-bank/kps');

/** 图都要带登录(卷子不能有直链): 取成 blob,用完 revoke */
async function blobUrl(path: string): Promise<string> {
  const blob = await client.get<Blob>(path, { responseType: 'blob', timeout: 30000 });
  return URL.createObjectURL(blob);
}
export const paperItemImageUrl = (itemId: number) => blobUrl(`/teacher/paper-bank/items/${itemId}/image`);
export const paperTileUrl = (docId: number, page: number, tile: number) =>
  blobUrl(`/teacher/paper-bank/docs/${docId}/pages/${page}/tiles/${tile}`);
export const quizItemImageUrl = (itemId: number) => blobUrl(`/student/paper-quiz/items/${itemId}/image`);

// ---------------------------------------------------------------- 老师: 全班

export interface KpRow { kp: string; name: string; weak: number; shaky: number; good: number; unknown: number; bank: number }
export interface StudentRow {
  id: number;
  name: string;
  top: Array<{ kp: string; name: string; label: string; p: number | null; misconceptions: string[] }>;
  answered: number;
  week: { n: number; right: number };
  today: { status: 'open' | 'done'; answered: number; total: number } | null;
}
export interface ClassView {
  class: { id: number; name: string; students: number };
  kps: KpRow[];
  students: StudentRow[];
  codes: Array<{ code: string; label: string; students: number }>;
  bank: BankStats;
}
export const getPaperClasses = () => client.get<{ items: Array<{ id: number; name: string }> }>('/teacher/paper-bank/classes');
export const getPaperClassView = (classId: number) => client.get<ClassView>(`/teacher/paper-bank/class/${classId}`);

export interface PrintItem {
  id: number;
  no: number;
  kind: 'mc' | 'fill';
  stem: string;
  options?: string[];
  blanks?: number;
  base_word: string;
  has_image: boolean;
  answer_text: string;
  explain: string;
  label: string;
  kp: string;
  note: string;
}
export interface PrintPaper { student: { id: number; name: string }; quiz_id: number; date: string; items: PrintItem[] }
export const printClassQuizzes = (classId: number) =>
  client.post<{ papers: PrintPaper[]; skipped: Array<{ id: number; name: string; reason: string }> }>(
    '/teacher/paper-bank/print', { class_id: classId }, { timeout: 120000 });

/** 布置每日小卷(走「句子 / 音标 / 复习作业」那一套,一天一份,当天截止) */
export const assignPaperQuiz = (studentIds: number[], days: number, gradeTarget: number) =>
  client.post<{ homework_ids: number[]; assigned: number }>('/teacher/content-homework', {
    kind: 'paper_quiz', target_ids: [gradeTarget], student_ids: studentIds, days,
  });

// ---------------------------------------------------------------- 平台管理员

export interface PaperAdminState {
  settings: { scope: 'off' | 'hq' | 'all'; daily_pages: number; daily_pages_all: number; quiz_size: number };
  scopes: string[];
  /** source: paper 用单独的 Key / tutor 用小鹰老师那个 Key / null 都没有(传不了卷子) */
  provider: { source: 'paper' | 'tutor' | null; configured: boolean; enabled: boolean; model: string; fallback_model: string; base_url: string };
  usage: { days: number; docs: number; pages: number; input_tokens: number; output_tokens: number };
}
export const getPaperAdmin = () => client.get<PaperAdminState>('/teacher/paper-bank/admin');
export const savePaperAdmin = (data: Partial<PaperAdminState['settings']> & {
  api_key?: string; model?: string; fallback_model?: string; base_url?: string; enabled?: boolean;
}) => client.put<PaperAdminState>('/teacher/paper-bank/admin', data);
export const testPaperAdmin = () =>
  client.post<{ ok: boolean; model: string; seconds: number; items: number }>('/teacher/paper-bank/admin/test', {}, { timeout: 300000 });

// ---------------------------------------------------------------- 学生

export interface QuizResult {
  correct: boolean;
  yours: string;
  answer: string | string[];
  answer_text: string;
  explain: string;
  why: string;
}
export interface QuizItem {
  id: number;
  kind: 'mc' | 'fill';
  stem: string;
  options?: string[];
  blanks?: number;
  base_word: string;
  has_image: boolean;
  result: QuizResult | null;
}
export interface Quiz {
  id: number;
  date: string;
  mode: 'daily' | 'diagnose';
  status: 'open' | 'done';
  total: number;
  answered: number;
  right: number;
  items: QuizItem[];
}
export interface QuizStatus {
  enabled: boolean;
  reason: string;
  today: { id: number; status: 'open' | 'done'; answered: number; right: number; total: number } | null;
}
export const getQuizStatus = () => client.get<QuizStatus>('/student/paper-quiz/status');
export const startTodayQuiz = () => client.post<Quiz>('/student/paper-quiz/today', {});
export const getQuiz = (id: number) => client.get<Quiz>(`/student/paper-quiz/${id}`);
export const answerQuiz = (quizId: number, itemId: number, answer: string | string[], ms: number) =>
  client.post<{ result: QuizResult; first: boolean; answered: number; right: number; total: number; done: boolean }>(
    `/student/paper-quiz/${quizId}/answer`, { item_id: itemId, answer, ms });
export interface QuizSummaryPoint { kp: string; kid: string; n: number; right: number; stage: number; lit: boolean }
export const getQuizSummary = (quizId: number) =>
  client.get<{ points: QuizSummaryPoint[]; right: number; total: number; status: string }>(`/student/paper-quiz/${quizId}/summary`);
