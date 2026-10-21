/**
 * 句子 / 音标视频作业(2026-10-21)
 *
 * 和单词作业分开存(后端 content_homework 表),口径也分开: 不发金币、不进单词数。
 * 完成不用交卷 —— 服务端按真实学习数据判(句子: 作业开放后全部组过关;视频: 看完)。
 */
import client from './client';

export type ContentKind = 'sentence' | 'phonetic_video';

export interface ContentTargetGroup {
  /** 句子 = 书 id;视频 = 讲师名 */
  id: number | string;
  name: string;
  units: { id: number; name: string }[];
}

export interface TeacherContentHomework {
  id: number;
  kind: ContentKind;
  kind_label: string;
  target_id: number;
  target_name: string;
  title: string;
  description: string | null;
  /** 北京日期 YYYY-MM-DD */
  available_date: string;
  same_day_only: boolean;
  is_closed: boolean;
  total: number;
  completed: number;
  assigned_by_name: string | null;
  can_manage: boolean;
}

export interface ContentHomeworkStudentStatus {
  student_id: number;
  name: string;
  status: 'completed' | 'pending' | 'locked' | 'overdue';
  completed_at: string | null;
}

export interface StudentContentHomework {
  id: number;
  homework_id: number;
  kind: ContentKind;
  kind_label: string;
  title: string;
  description: string | null;
  target_name: string;
  target_id: number;
  status: 'completed' | 'pending' | 'locked' | 'overdue';
  /** 点「去完成」跳到这里;视频还要带 state.openVideoId 直接打开那一节 */
  route: string;
  available_from: string;
  deadline: string | null;
  completed_at: string | null;
  teacher_name: string;
}

export const getContentTargets = (kind: ContentKind) =>
  client.get('/teacher/content-homework/targets', { params: { kind } }) as unknown as Promise<ContentTargetGroup[]>;

export const createContentHomework = (body: {
  kind: ContentKind;
  target_ids: number[];
  student_ids: number[];
  title?: string;
  description?: string;
  available_date?: string;
  daily_sequence?: boolean;
  same_day_only?: boolean;
}) => client.post('/teacher/content-homework', body) as unknown as Promise<{ homework_ids: number[]; assigned: number }>;

export const listTeacherContentHomework = () =>
  client.get('/teacher/content-homework') as unknown as Promise<TeacherContentHomework[]>;

export const getContentHomeworkStudents = (id: number) =>
  client.get(`/teacher/content-homework/${id}/students`) as unknown as Promise<ContentHomeworkStudentStatus[]>;

export const toggleContentHomework = (id: number) =>
  client.post(`/teacher/content-homework/${id}/toggle-closed`) as unknown as Promise<{ is_closed: boolean }>;

export const deleteContentHomework = (id: number) =>
  client.delete(`/teacher/content-homework/${id}`);

export const getMyContentHomework = () =>
  client.get('/student/content-homework') as unknown as Promise<StudentContentHomework[]>;
