import axios from 'axios';
import './_axiosBootstrap';
import { API_BASE_URL } from '../config/env';

export interface ClassStudent {
  id: number;
  username: string;
  full_name: string | null;
  joined_at: string;
}

export interface GroupScore {
  unit_id: number;
  unit_name: string;
  group_index: number;
  word_count: number;
  learned_count: number;
  mastered_count: number;
  accuracy: number;
  last_studied_at: string | null;
}

export interface GroupWord {
  word_id: number;
  word: string;
  mastery_level: number;
  correct_count: number;
  total_attempts: number;
  last_practiced_at: string | null;
}

export interface ClassOverview {
  student_count: number;
  avg_accuracy: number;
  total_words_studied: number;
  mastered_words: number;
}

export interface WordCompletionItem {
  word_id: number;
  word: string;
  learners: number;
  mastered: number;
}

export interface DailyContentItem {
  unit_id: number;
  unit_name: string;
  unit_number: number | null;
  book_id: number | null;
  book_name: string;
  group_indices: number[];
  words_studied: number;
  time_spent: number;
  sessions_count: number;
}

export interface ClassRankingEntry {
  rank: number;
  user_id: number;
  username: string;
  full_name: string;
  score: number;
  metric_name: string;
}

export type ClassRankingMetric = 'mastered_words' | 'accuracy' | 'study_time';
export type ClassRankingPeriod = 'today' | 'this_week' | 'this_month' | 'all';

const BASE = `${API_BASE_URL}/teacher`;
const ANALYTICS = `${API_BASE_URL}/teacher/analytics`;

export const teacherMonitor = {
  classStudents: async (class_id: number, q?: string): Promise<ClassStudent[]> => {
    const r = await axios.get(`${BASE}/classes/${class_id}/students`, { params: q ? { q } : {} });
    return r.data;
  },

  studentGroups: async (student_id: number): Promise<GroupScore[]> => {
    const r = await axios.get(`${BASE}/students/${student_id}/groups`);
    return r.data;
  },

  groupWords: async (
    student_id: number, unit_id: number, group_index: number
  ): Promise<GroupWord[]> => {
    const r = await axios.get(
      `${BASE}/students/${student_id}/groups/${unit_id}/${group_index}/words`
    );
    return r.data;
  },

  classOverview: async (class_id: number): Promise<ClassOverview> => {
    const r = await axios.get(`${ANALYTICS}/classes/${class_id}/overview`);
    return r.data;
  },

  classWordCompletion: async (class_id: number): Promise<WordCompletionItem[]> => {
    const r = await axios.get(`${ANALYTICS}/classes/${class_id}/word-completion`);
    return r.data;
  },

  classAssignmentsProgress: async (class_id: number) => {
    const r = await axios.get(`${ANALYTICS}/classes/${class_id}/assignments-progress`);
    return r.data;
  },

  dailyStatsContent: async (
    class_id: number, student_id: number, target_date: string
  ): Promise<{ student_id: number; date: string; items: DailyContentItem[] }> => {
    const r = await axios.get(
      `${BASE}/classes/${class_id}/daily-stats/${student_id}/content`,
      { params: { target_date } }
    );
    return r.data;
  },

  classRanking: async (
    class_id: number,
    metric: ClassRankingMetric = 'mastered_words',
    period: ClassRankingPeriod = 'all',
  ): Promise<ClassRankingEntry[]> => {
    const r = await axios.get(`${ANALYTICS}/classes/${class_id}/ranking`, {
      params: { metric, period },
    });
    return r.data;
  },
};
