/**
 * 音标学习报告 API(2026-11-03)。数从 backend/app/services/phonetic_report.py 出,三种人看同一份口径
 */
import api from './client';

export type ReportDays = 7 | 30 | 90 | 0;

export interface PhonemeStat {
  phoneme: string;
  vowel: boolean;
  seen: number;
  right: number;
  rate: number | null;
  enough: boolean;
  weak: boolean;
  wrong_as: { phoneme: string; times: number }[];
  words: string[];
  lesson: { id: number; code: string } | null;
}

export interface Advice { text: string; lesson: { id: number; code: string } | null; teacher_only?: boolean }

export interface ReportSummary {
  days: number;
  active_days: number;
  minutes: number;
  write: { words: number; first_right: number; lessons: number; minutes: number };
  read: { words: number; judged: number; green: number; yellow: number; red: number; self_passed: number; lessons: number; minutes: number };
  listen: { items: number; first_right: number; word_wrong: number; phonetic_wrong: number; gave_up: number; sets: number; minutes: number };
  video: { started: number; completed: number; minutes: number };
}

export interface FullReport {
  student?: { id: number; name: string };
  summary: ReportSummary;
  weak_phonemes: PhonemeStat[];
  phonemes: PhonemeStat[];
  confusions: { should: string; wrote: string; times: number; words: string[] }[];
  read_issues: { code: string; label: string; how: string; times: number; words: string[] }[];
  hard_reads: { word: string; phonetic: string; code: string; tries: number; best: string | null; last_grade: string | null;
    last_reading_id: number | null; issue_label: string | null; self_passed: boolean }[];
  hard_writes: { word: string; code: string; answer: string; wrote: string | null; tries: number; ever_ok: boolean }[];
  listen_wrong: { word: string; set: string; word_ok: boolean; phonetic_ok: boolean; wrote: string | null; gave_up: boolean }[];
  lessons: { kind: 'write' | 'read' | 'listen'; lesson_id?: number; set_id?: number; code: string; items: number;
    first_right?: number; green?: number; word_wrong?: number; phonetic_wrong?: number; last: string | null }[];
  daily: { day: string; n: number }[];
  advice: Advice[];
  has_data: boolean;
}

export interface BriefReport {
  days: number;
  active_days: number;
  minutes: number;
  write: { words: number; first_right: number };
  read: { words: number; green: number };
  listen: { items: number; first_right: number };
  video: { started: number; completed: number; minutes: number };
  practice: { phoneme: string; right: number; seen: number; lesson: { id: number; code: string } | null; words: string[] }[];
  advice: Advice[];
  has_data: boolean;
}

export interface ClassReport {
  days: number;
  not_started: number;
  class_weak: { phoneme: string; students: number; names: string[] }[];
  students: { id: number; name: string; active_days: number; minutes: number; write_words: number; write_first_right: number;
    read_words: number; read_green: number; read_judged: number; listen_items: number; listen_first_right: number;
    video_completed: number; weak: string[]; has_data: boolean }[];
}

export const studentPhoneticReport = (id: number, days: ReportDays): Promise<FullReport> =>
  api.get(`/teacher/phonetic-books/report/students/${id}`, { params: { days } });
export const classPhoneticReport = (days: ReportDays): Promise<ClassReport> =>
  api.get('/teacher/phonetic-books/report/class', { params: { days } });
export const myPhoneticReport = (days: ReportDays): Promise<BriefReport> =>
  api.get('/phonetic-practice/report/me', { params: { days } });
export const childPhoneticReport = (id: number, days: ReportDays): Promise<BriefReport> =>
  api.get(`/phonetic-practice/report/children/${id}`, { params: { days } });

export const DAYS_OPTIONS: { v: ReportDays; label: string }[] = [
  { v: 7, label: '近 7 天' }, { v: 30, label: '近 30 天' }, { v: 90, label: '近 90 天' }, { v: 0, label: '全部' },
];

export const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
