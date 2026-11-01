/** 小鹰老师自动布置作业。规则真源 backend/app/services/autopilot.py 文件头 */
import client from './client';
import { submitReliably } from './submitQueue';

export type Mode = 'auto' | 'manual';
export type Place = 'classroom' | 'home';

export interface PlanItem {
  kind: 'round' | 'new' | 'review';
  unit_id: number;
  unit_name: string;
  groups: number[];
  round: number;
  words: number;
  title?: string;
  done?: boolean;
  batch?: number;
}

export interface ClassSettings {
  class_id: number;
  name: string;
  mode: Mode;
  class_days: number[];
  default_location: Place;
  day_overrides: Record<string, Place>;
  max_words: number | null;
  pass_line: number | null;
  paused: boolean;
  today_location: Place;
  today_location_reason: string;
  updated_by_name: string | null;
}

export interface TodoItem {
  kind: 'alert' | 'handoff' | 'stuck' | 'struggling' | 'absent' | 'no_book' | 'gated' | 'finished';
  label: string;
  student_id: number;
  student_name: string;
  class_name: string;
  text: string;
}

export interface Overview {
  enabled: boolean;
  classes: ClassSettings[];
  todo: TodoItem[];
  rules: { tiers: number[]; pass_lines: number[]; new_kid_words: number; graduate_rounds: number;
    extra_batches: number; evening: string };
}

export interface BoardToday {
  status: string;
  reason: string;
  source: 'auto' | 'teacher';
  actor_name: string;
  location: Place | null;
  items: PlanItem[];
  done: number;
  total: number;
  extra_batches: number;
  comment_source: 'ai' | 'rule' | 'skip' | null;
  comment_flag: string | null;
}

export interface BoardStudent {
  id: number;
  name: string;
  tier: number | null;
  tier_reason: string;
  fixed_words: number | null;
  pass_line: number;
  pass_line_reason: string;
  fixed_pass_line: number | null;
  paused: boolean;
  book_id: number | null;
  book_name: string;
  start_unit_id: number | null;
  enrolled: boolean;
  today: BoardToday | null;
  groups: { learning: number; graduated: number; stuck: number; due: number };
  last_day: string | null;
  /** 开了跟学校进度的班才有 */
  catchup?: { diagnosis: { status: string; known_units: number; gap_units: number; questions: number } | null;
              progress: GapProgress };
}

export interface Suggestion {
  status: 'ok' | 'no_book' | 'gated' | 'finished';
  reason: string;
  book_name: string;
  items: PlanItem[];
  words: number;
  tier: number;
  tier_reason: string;
  pass_line: number;
  pass_line_reason: string;
  location: Place;
  location_reason: string;
}

export interface StudentToday {
  active: boolean;
  /** 今天签没签到(签到才能做,2026-10-31) */
  checked_in?: boolean;
  /** 自动班还没签到: 签到那一刻才派 */
  waiting_checkin?: boolean;
  /** 老师今天自己布置了作业,小鹰老师只补了一小份漏洞(开了跟学校进度的班) */
  gap_only?: boolean;
  gap_items?: (PlanItem & { assignment_id: number | null; is_content: boolean })[];
  /** 查缺补漏(开了的班才有) */
  catchup?: CatchupBrief | null;
  pass_line: number;
  pass_line_reason: string;
  tier?: number;
  location?: Place;
  items?: (PlanItem & { assignment_id: number | null; is_content: boolean })[];
  extra_items?: (PlanItem & { assignment_id: number | null; is_content: boolean })[];
  all_done?: boolean;
  extra_left?: number;
  extra_open?: boolean;
  repeats_today?: number;
}

export interface GapProgress {
  units: number; groups: number; words: number; fixed_groups: number; fixed_words: number; fixed_units: number;
  /** 测出要补、但书没开(要老师开书才能补)的单元数 */
  blocked_units?: number;
}

export interface BookGaps {
  no_book: { student_id: number; name: string; book_id: number; book_name: string; locked: string | null }[];
  gap_books: { student_id: number; name: string; books: { book_id: number; book_name: string; locked: string | null }[] }[];
  unknown: { student_id: number; name: string }[];
}

export interface CatchupBrief {
  diagnosis: { status: 'pending' | 'doing' | 'done' | 'skipped'; id: number } | null;
  progress: GapProgress;
}

export interface CatchupResult {
  id: number; status: string; known_units: number; gap_units: number; questions: number; note: string;
  gaps: { unit_id: number; unit: string; book: string; blocked?: boolean }[];
  progress: GapProgress;
  finished_at: string | null;
  requested_by_name: string;
}

export interface CatchupQuestion {
  word_id: number;
  type: 'choice' | 'spell';
  unit: string;
  word?: string;
  options?: string[];
  meaning?: string;
  letters?: number;
  first?: string;
}

export interface CatchupState {
  status: 'none' | 'pending' | 'doing' | 'done' | 'skipped';
  answered?: number;
  left?: number;
  units_done?: number;
  question?: CatchupQuestion | null;
  result?: CatchupResult;
  minutes?: number;
  /** 老师选了必须测完时为 false */
  can_finish_early?: boolean;
  /** 刚交的那一题 */
  correct?: boolean;
  right?: string;
  word?: string;
  stale?: boolean;
}

export type SyncOptionValue = boolean | number | string;

export interface SyncOptionMeta {
  key: string;
  label: string;
  default: SyncOptionValue;
  choices: { value: SyncOptionValue; label: string }[];
  /** 选了会怎样 */
  effect: string;
  /** 风险(原样给老师看) */
  risk: string;
}

export interface ClassSync {
  options: Record<string, SyncOptionValue>;
  option_meta: SyncOptionMeta[];
  enabled: boolean;
  school_book_id: number | null; school_book_name: string;
  school_unit_id: number | null; school_unit_name: string;
  updated_by_name: string;
}

export interface AttemptResult {
  required: number;
  passed: boolean;
  round: number | null;
  graduated: boolean;
  extra: boolean;
  groups: number[];
  completed_homework?: number[];
  coin_awarded?: boolean;
  duplicate?: boolean;
}

export const autopilotApi = {
  overview: () => client.get<Overview>('/teacher/autopilot/overview'),
  board: (classId: number) =>
    client.get<{ class: ClassSettings; students: BoardStudent[]; sync?: ClassSync }>(`/teacher/autopilot/classes/${classId}`, { timeout: 30000 }),
  syncBooks: (classId: number) =>
    client.get<{ books: { id: number; name: string; kids: number; units: { id: number; name: string }[] }[] }>(
      `/teacher/autopilot/classes/${classId}/sync-books`).then(r => r.books),
  saveSync: (classId: number, body: Partial<{ enabled: boolean; school_book_id: number | null; school_unit_id: number | null;
    options: Record<string, SyncOptionValue | boolean> }>) =>
    client.put<ClassSync & { requested?: number }>(`/teacher/autopilot/classes/${classId}/sync`, body),
  bookGaps: (classId: number) => client.get<BookGaps>(`/teacher/autopilot/classes/${classId}/book-gaps`, { timeout: 30000 }),
  openBooks: (classId: number, items: { student_id: number; book_id: number }[]) =>
    client.post<{ created: number; already: number; locked: { student_id: number; book_name: string; reason: string }[]; missing: number }>(
      `/teacher/autopilot/classes/${classId}/open-books`, { items }, { timeout: 30000 }),
  requestCatchup: (classId: number, studentIds: number[]) =>
    client.post<{ requested: number }>(`/teacher/autopilot/classes/${classId}/catchup`, { student_ids: studentIds }),
  suggestions: (classId: number) =>
    client.get<{ suggestions: Record<string, Suggestion> }>(`/teacher/autopilot/classes/${classId}/suggestions`, { timeout: 30000 })
      .then(r => r.suggestions),
  saveClass: (classId: number, body: Partial<{
    mode: Mode; class_days: number[]; default_location: Place; max_words: number | null; pass_line: number | null;
    paused: boolean; day_override: { date: string; location: Place | '' };
  }>) => client.put<ClassSettings>(`/teacher/autopilot/classes/${classId}`, body),
  saveStudent: (studentId: number, body: Partial<{
    fixed_words: number | null; fixed_pass_line: number | null; paused: boolean; book_id: number | null;
    start_unit_id: number | null;
  }>) => client.put(`/teacher/autopilot/students/${studentId}`, body),
  books: (studentId: number) =>
    client.get<{ books: { id: number; name: string; units: { id: number; name: string }[] }[] }>(
      `/teacher/autopilot/students/${studentId}/books`).then(r => r.books),
  dispatch: (classId: number, studentIds: number[]) =>
    client.post<{ results: { student_id: number; status: string; reason?: string; already?: boolean }[]; dispatched: number }>(
      `/teacher/autopilot/classes/${classId}/dispatch`, { student_ids: studentIds }, { timeout: 60000 }),
  undo: (studentId: number) =>
    client.post<{ removed: number }>(`/teacher/autopilot/students/${studentId}/undo`),
  todo: () => client.get<{ items: TodoItem[] }>('/teacher/autopilot/todo').then(r => r.items),

  // 学生: 摸底
  catchup: () => client.get<CatchupState>('/student/catchup', { timeout: 20000 }),
  catchupAnswer: (body: { word_id: number; choice?: number; text?: string; dont_know?: boolean }) =>
    client.post<CatchupState>('/student/catchup/answer', body, { timeout: 20000 }),
  catchupFinish: () => client.post<CatchupState>('/student/catchup/finish', {}, { timeout: 20000 }),

  // 学生
  today: () => client.get<StudentToday>('/student/autopilot/today', { timeout: 20000 }),
  extra: () => client.post<{ ok: boolean; batch: number; items: PlanItem[] }>('/student/autopilot/extra'),
  /** 过关检测每一次都记(过了没过都记)。走可靠队列: 断网了联网后补交,后端按 client_batch_id 去重 */
  attempt: (body: { unit_id: number; word_ids: number[]; score: number }) =>
    submitReliably<AttemptResult>('/student/autopilot/attempt', body),

  // 平台
  admin: () => client.get<AdminState>('/admin/autopilot'),
  saveAdmin: (enabled: boolean) => client.put<AdminState>('/admin/autopilot', { enabled }),
};

export interface AdminState {
  enabled: boolean;
  auto_classes: number;
  today: Record<string, number>;
  ai_comments_today: number;
  ai_tokens_today: number;
  students: number;
}

export const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

export function itemLabel(i: PlanItem): string {
  if (i.kind === 'review') return `今天的复习词 ${i.words} 个`;
  const g = i.groups.length === 1 ? `第${i.groups[0]}组` : `第${i.groups[0]}–${i.groups[i.groups.length - 1]}组`;
  const tail = i.kind === 'new' ? '新词' : `第${i.round}轮`;
  return `${i.unit_name} ${g} · ${tail}(${i.words} 个)`;
}
