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
    client.get<{ class: ClassSettings; students: BoardStudent[] }>(`/teacher/autopilot/classes/${classId}`, { timeout: 30000 }),
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
