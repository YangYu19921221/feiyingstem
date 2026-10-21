/** 陪跑(老师每天看谁没来、谁没做完,复制提醒发家长,给每个孩子留一句话)。口径真源 backend services/coach.py */
import client from './client';

export type CoachStatus = 'absent' | 'not_started' | 'in_progress' | 'done' | 'gone';

export interface CoachNoteInfo {
  content: string;
  author_name: string;
  read_by_student: boolean;
  read_by_parent: boolean;
}

export interface CoachRow {
  id: number;
  name: string;
  full_name: string;
  username: string;
  class_name: string;
  status: CoachStatus;
  /** 今天计分题做了 ≥10 题且正确率 < 70% */
  struggling: boolean;
  last_study_day: string | null;
  /** 距今几天没学;null = 从没学过 */
  days_since: number | null;
  /** 近 7 天学了几天 */
  week_days: number;
  tasks_total: number;
  tasks_done: number;
  words_today: number;
  minutes_today: number;
  scored_today: number;
  accuracy_today: number | null;
  review_due: number;
  weak_today: string[];
  parent_bound: boolean;
  note: CoachNoteInfo | null;
  /** 系统按今天的数据起草的点评 */
  draft: string;
  /** 复制给家长的提醒 */
  remind: string;
}

export interface CoachBoard {
  date: string;
  items: CoachRow[];
  counts: Record<CoachStatus, number>;
  struggling: number;
  noted: number;
  absent_days: number;
}

export interface MyCoachNote {
  date: string;
  content: string;
  author_name: string;
  is_today: boolean;
}

export const coachApi = {
  board: (): Promise<CoachBoard> => client.get('/teacher/coach/board'),
  save: (studentId: number, content: string): Promise<{ content: string; author_name: string }> =>
    client.put(`/teacher/coach/notes/${studentId}`, { content }),
  saveBatch: (items: Array<{ student_id: number; content: string }>): Promise<{ saved: number }> =>
    client.post('/teacher/coach/notes/batch', { items }),
  remove: (studentId: number): Promise<{ ok: boolean }> => client.delete(`/teacher/coach/notes/${studentId}`),
  /** 学生首页「老师的话」 */
  mine: (): Promise<{ note: MyCoachNote | null }> => client.get('/student/coach-note'),
  /** 家长端: 最近两周 */
  forChild: (studentId: number): Promise<{ items: Array<{ date: string; content: string; author_name: string }> }> =>
    client.get(`/parent/children/${studentId}/coach-notes`),
};
