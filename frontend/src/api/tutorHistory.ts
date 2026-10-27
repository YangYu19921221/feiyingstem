/**
 * 学习助手的对话记录 + 讲解方式(2026-10-27)。规则见后端 services/tutor_history.py、services/tutor_level.py
 */
import client from './client';

/** 收藏 / 今天 / 3 天内 / 7 天内 / 一个月内 / 更早(按北京日,后端算好) */
export type HistoryGroup = 'starred' | 'today' | '3d' | '7d' | '30d' | 'older';

export const HISTORY_GROUP_LABEL: Record<HistoryGroup, string> = {
  starred: '收藏',
  today: '今天',
  '3d': '3 天内',
  '7d': '7 天内',
  '30d': '一个月内',
  older: '更早',
};

export interface HistoryItem {
  id: number;
  title: string;
  message_count: number;
  updated_at: string | null;
  starred: boolean;
  group: HistoryGroup;
  /** 孩子在这段对话里问了几次 */
  questions: number;
  /** 搜索时: 命中的那句话的一小段 */
  snippet: string | null;
}

export interface HistoryPage {
  items: HistoryItem[];
  has_more: boolean;
  /** 没收藏的对话多少天没动就自动删 */
  keep_days: number;
  /** 孩子删掉的,老师那边还能看几天 */
  deleted_keep_days: number;
}

export const HISTORY_PAGE = 30;

export const listHistory = (q: string, offset = 0) =>
  client.get<HistoryPage>('/student/tutor/conversations', { params: { q: q || undefined, offset, limit: HISTORY_PAGE } });
export const renameConversation = (id: number, title: string) =>
  client.patch<HistoryItem>(`/student/tutor/conversations/${id}`, { title });
export const starConversation = (id: number, starred: boolean) =>
  client.patch<HistoryItem>(`/student/tutor/conversations/${id}`, { starred });
export const deleteConversation = (id: number) =>
  client.delete<{ ok: boolean; deleted_keep_days: number }>(`/student/tutor/conversations/${id}`);

// ---- 讲解方式: 年级 + 讲简单一点 / 正常 / 讲深一点(不给孩子贴「聪明 / 笨」的标签)
export type TutorPace = 'simple' | 'normal' | 'deep';

export interface TutorLevel {
  /** 一年级…高三;null = 不知道 */
  grade: string | null;
  /** 年级从哪来: 孩子自己设的 / 老师设的 / 按在学的书推断 / 都没有 */
  grade_source: 'student' | 'teacher' | 'book' | 'none';
  /** 按书推断时是哪本书 */
  book: string | null;
  band: 'p_low' | 'p_high' | 'junior' | 'senior';
  band_label: string;
  pace: TutorPace;
  pace_label: string;
  /** auto = 小鹰老师看最近的表现自己调 */
  pace_mode: 'auto' | 'student' | 'teacher';
  auto_pace: TutorPace;
  auto_label: string;
  /** 自动调的原因(给老师看) */
  auto_reasons: string[];
  grade_options: string[];
}

/** 只传要改的: grade 传 null = 改回按书推断;pace 传 auto = 改回自动 */
export type TutorLevelPatch = { grade?: string | null; pace?: TutorPace | 'auto' };

export const getMyLevel = () => client.get<TutorLevel>('/student/tutor/prefs');
export const setMyLevel = (body: TutorLevelPatch) => client.put<TutorLevel>('/student/tutor/prefs', body);
export const setStudentLevel = (studentId: number, body: TutorLevelPatch) =>
  client.put<TutorLevel>(`/teacher/students/${studentId}/tutor-prefs`, body);

export const PACE_OPTIONS: Array<{ value: TutorPace; label: string; hint: string }> = [
  { value: 'simple', label: '讲简单一点', hint: '多举例子,一步一步来' },
  { value: 'normal', label: '正常', hint: '按年级正常讲' },
  { value: 'deep', label: '讲深一点', hint: '少铺垫,多来点挑战' },
];
