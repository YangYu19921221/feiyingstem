/**
 * 学校考试 · 丢分分析(2026-11-26)。规则见后端 services/school_exam.py 文件头。
 *
 * 老师建一次考试(班、名字、卷子 = 试卷库里拆好的那份)→ 录分项分 / 孩子拍批改过的卷子 →
 * 每个孩子「这次考试丢分在哪」+ 全班汇总。照片不存,只存读出来的字。
 */
import client from './client';

export interface ExamSection { name: string; full: number | null }

export interface SchoolExam {
  id: number;
  class_id: number;
  class_name?: string;
  name: string;
  exam_date: string | null;
  doc_id: number | null;
  doc_title: string | null;
  doc_status: string | null;
  paper_title: string | null;
  sections: ExamSection[];
  full_score: number | null;
  open_upload: boolean;
  items: number | null;
  created_by_name: string | null;
}

export interface SheetInfo {
  id: number;
  status: 'pending' | 'done' | 'failed';
  reason: string | null;
  pages: number;
  by: 'student' | 'teacher' | null;
  created_at: string | null;
  confirm: number;
  missing: number;
  recorded: number;
}

export interface ExamMeta {
  enabled: boolean;
  reason: string;
  classes: Array<{ id: number; name: string }>;
  docs: Array<{ id: number; title: string; grade: string | null; status: string;
    papers: Array<{ title: string; items: number }> }>;
  default_sections: ExamSection[];
  max_pages: number;
  max_sheets: number;
}

export interface ClassReport {
  exam: SchoolExam;
  sections: Array<{ name: string; full: number | null; n: number; avg: number | null; lost_avg: number | null }>;
  kps: Array<{ kp: string; name: string; wrong: number; seen: number }>;
  codes: Array<{ code: string; label: string; students: number }>;
  students: Array<{
    id: number; name: string; total: number | null; sections: Record<string, number | null>;
    weakest: string | null; top: string[]; wrong: number; recorded: number; sheet: SheetInfo | null;
  }>;
  uploaded: number;
  confirm: number;
  avg_total: number | null;
  n_total: number;
  items_total: number;
}

export interface SheetItem {
  item_id: number;
  no: string | null;
  given: string;
  mark: 'right' | 'wrong' | 'half' | 'none';
  lost: number | null;
  unsure: boolean;
  found: boolean;
  judged: boolean | null;
  final: boolean | null;
  state: 'recorded' | 'confirm' | 'missing';
  note: string;
  stem: string;
  answer: string;
  options: string[];
  recorded: boolean | null;
}

export interface StudentReport {
  student?: { id: number; name: string };
  exam: SchoolExam;
  score: {
    total: number | null; full: number | null; total_source?: string | null;
    sections: Array<{ name: string; full: number | null; score: number | null; lost: number | null; source?: string | null }>;
  };
  sheet: SheetInfo | null;
  recorded: number;
  wrong: number;
  kps: Array<{ kp: string; name: string; kid: string; wrong: number; total: number; codes: string[] }>;
  ok_kps: string[];
  wrong_items: Array<{
    item_id: number; no: string | null; section: string | null; kind: 'mc' | 'fill'; stem: string; options: string[];
    given: string; answer: string; explain: string; why: string; kps: string[]; source: string;
  }>;
  untracked: Array<{ name: string; lost: number }>;
  items_total: number;
  sheet_items?: SheetItem[];
  can_upload?: boolean;
  max_pages?: number;
}

export interface ExamInput {
  class_id?: number;
  name?: string;
  exam_date?: string | null;
  doc_id?: number | null;
  paper_title?: string | null;
  sections?: ExamSection[];
  full_score?: number | null;
  open_upload?: boolean;
}

export const getExamMeta = () => client.get<ExamMeta>('/teacher/school-exams/meta');
export const listExams = (classId?: number) =>
  client.get<{ items: SchoolExam[] }>('/teacher/school-exams', { params: classId ? { class_id: classId } : {} });
export const createExam = (data: ExamInput) => client.post<SchoolExam>('/teacher/school-exams', data);
export const getExam = (id: number) => client.get<ClassReport>(`/teacher/school-exams/${id}`);
export const patchExam = (id: number, data: ExamInput) => client.patch<SchoolExam>(`/teacher/school-exams/${id}`, data);
export const deleteExam = (id: number) => client.delete<{ ok: boolean }>(`/teacher/school-exams/${id}`);
export const putScores = (id: number, rows: Array<{ student_id: number; total: number | string | null;
  sections: Record<string, number | string | null> }>) =>
  client.put<{ changed: number }>(`/teacher/school-exams/${id}/scores`, { rows });
export const getStudentReport = (id: number, sid: number) =>
  client.get<StudentReport>(`/teacher/school-exams/${id}/students/${sid}`);
export const resolveItem = (id: number, sid: number, itemId: number, correct: boolean) =>
  client.put<{ item_id: number; correct: boolean }>(`/teacher/school-exams/${id}/students/${sid}/items/${itemId}`, { correct });

function sheetForm(photos: Blob[]) {
  const fd = new FormData();
  photos.forEach((b, i) => fd.append('files', b, `page${i + 1}.jpg`));
  return fd;
}

export const teacherUploadSheet = (id: number, sid: number, photos: Blob[]) =>
  client.post<{ sheet_id: number }>(`/teacher/school-exams/${id}/students/${sid}/sheets`, sheetForm(photos),
    { timeout: 180000 });

// ---------------------------------------------------------------- 学生

export interface MyExam extends SchoolExam { sheet: SheetInfo | null; can_upload: boolean }

export const listMyExams = () =>
  client.get<{ enabled: boolean; reason: string; items: MyExam[]; max_pages?: number }>('/student/school-exams');
export const getMyReport = (id: number) => client.get<StudentReport>(`/student/school-exams/${id}`);
export const uploadMySheet = (id: number, photos: Blob[]) =>
  client.post<{ sheet_id: number }>(`/student/school-exams/${id}/sheets`, sheetForm(photos), { timeout: 180000 });
