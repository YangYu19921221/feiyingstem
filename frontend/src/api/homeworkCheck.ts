/** 作业批改(2026-10-30)。规则真源 backend/app/services/homework_check.py 文件头 */
import client from './client';

export type ItemResult = 'right' | 'wrong' | 'blank' | 'unclear';

export interface CheckItem {
  idx: number;
  no: string;
  question: string;
  answer: string;
  result: ItemResult;
  /** false = 作文、开放题: 只给修改建议,不在网页上订正 */
  checkable: boolean;
  topic: string;
  hint: string;
  /** 只有对的、改对了的、改了 2 次还不对给了答案的才有 */
  explain: string;
  /** 只有改对了 / 给了答案的才有;没写的题永远是空的 */
  correct: string[];
  tries: number;
  tries_left: number;
  fixed: boolean;
  last: string;
  revealed: boolean;
  can_fix: boolean;
  disputed: boolean;
}

export interface HomeworkCheck {
  id: number;
  status: 'pending' | 'done' | 'failed';
  created_at: string | null;
  finished_at: string | null;
  reason: string;
  total: number;
  right: number;
  wrong: number;
  blank: number;
  fixed: number;
  cost: number;
  disputed: number;
  items?: CheckItem[];
}

export interface CheckStatus {
  enabled: boolean;
  reason: string;
  left: number;
  cost: number;
  reveal_after: number;
  /** 还在批的那一页(刷新后接着等) */
  pending: number | null;
}

export const homeworkCheckApi = {
  status: () => client.get<CheckStatus>('/student/homework-check/status'),
  start: (image: Blob) => {
    const fd = new FormData();
    fd.append('image', image, 'homework.jpg');
    return client.post<{ id: number }>('/student/homework-check', fd, { timeout: 60000 });
  },
  list: () => client.get<{ items: HomeworkCheck[] }>('/student/homework-check').then((r) => r.items),
  get: (id: number) => client.get<HomeworkCheck>(`/student/homework-check/${id}`),
  fix: (id: number, idx: number, answer: string) =>
    client.post<{ ok: boolean; item: CheckItem; fixed: number }>(`/student/homework-check/${id}/items/${idx}/fix`, { answer }),
  dispute: (id: number, idx: number) =>
    client.post<{ item: CheckItem }>(`/student/homework-check/${id}/items/${idx}/dispute`),
  // 老师: 本班学生批过的作业(带正确答案)
  ofStudent: (studentId: number) =>
    client.get<{ items: HomeworkCheck[] }>(`/teacher/students/${studentId}/homework-checks`).then((r) => r.items),
};
