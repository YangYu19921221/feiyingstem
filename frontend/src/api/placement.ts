/** 入学摸底测评 API */
import client from './client';

// ── 类型 ──────────────────────────────────────────────────────────────────────

export interface PlacementQuestion {
  word_id: number;
  word: string;
  phonetic: string;
  question_type: 'recognition' | 'spelling';
  // recognition 专用
  options?: string[];
  // spelling 专用
  prompt?: string;
  difficulty: number;
}

export interface StartResponse {
  test_id: number;
  questions: PlacementQuestion[];
  total: number;
  resumed: boolean;
}

export interface SubmitAnswer {
  word_id: number;
  question_type: 'recognition' | 'spelling';
  chosen_index?: number;
  typed_answer?: string;
}

export interface SkillProfile {
  recognition_accuracy: number;
  spelling_accuracy: number | null;
  solid_through_band: number;
  first_gap_band: number | null;
  band_scores: Record<string, number>;
  placement_difficulty: number;
  placement_label: string;
  recommendation: string;
}

export interface SubmitResponse {
  test_id: number;
  correct_count: number;
  total_questions: number;
  placement_difficulty: number;
  placement_label: string;
  recognition_accuracy: number;
  spelling_accuracy: number | null;
  solid_through_band: number;
  first_gap_band: number | null;
  band_scores: Record<string, number>;
  recommendation: string;
  weak_words: { word_id: number; word: string; difficulty: number; question_type: string }[];
  known_words_seeded: number;
  results: { word_id: number; word: string; question_type: string; difficulty: number; is_correct: boolean }[];
}

export interface PlacementResult {
  has_placement: boolean;
  test_id?: number;
  status?: 'completed' | 'skipped' | 'pending';
  placement_difficulty?: number;
  placement_label?: string;
  self_reported_level?: string;
  correct_count?: number;
  total_questions?: number;
  skill_profile?: SkillProfile;
  weak_words?: { word_id: number; word: string; difficulty: number; question_type: string }[];
  known_words_seeded?: number;
  completed_at?: string;
}

export interface TeacherPlanPhase {
  name: string;
  duration_weeks: number;
  goal: string;
  focus_modes: string[];
  daily_quota: number;
  note?: string;
}

export interface TeacherPlan {
  phases: TeacherPlanPhase[];
  gap_remediation: {
    needed: boolean;
    gap_bands: number[];
    gap_band_labels: string[];
    weak_word_count: number;
    strategy: string;
  };
  teacher_actions: { priority: number; action: string; reason: string }[];
  recommended_book_hint: string;
  daily_quota: number;
  total_plan_weeks: number;
  priority_modes: string[];
}

export interface NeedsActionItem {
  student_id: number;
  name: string;
  reason: string;
  priority: number;
}

export interface ClassOverview {
  total_students: number;
  completed: number;
  skipped: number;
  pending: number;
  not_started: number;
  completion_rate: number;
  distribution: Record<string, number>;
  needs_action: NeedsActionItem[];
}

// ── 学生端 ────────────────────────────────────────────────────────────────────

export const placementApi = {
  start: () =>
    client.post<StartResponse>('/student/placement/start'),

  submit: (test_id: number, answers: SubmitAnswer[]) =>
    client.post<SubmitResponse>('/student/placement/submit', { test_id, answers }),

  skip: (self_reported_level: string) =>
    client.post('/student/placement/skip', { self_reported_level }),

  result: () =>
    client.get<PlacementResult>('/student/placement/result'),

  // ── 教师端 ──────────────────────────────────────────────────────────────────
  classOverview: () =>
    client.get<ClassOverview>('/teacher/placement/class-overview'),

  studentResult: (student_id: number) =>
    client.get<PlacementResult & { student_id: number }>(`/teacher/placement/student/${student_id}`),

  studentPlan: (student_id: number, ai_narrative = false) =>
    client.get<{ has_placement: boolean; student_id: number; student_name: string;
      placement_difficulty: number; placement_label: string;
      plan: TeacherPlan; ai_narrative: string | null }>(
      `/teacher/placement/student/${student_id}/plan`,
      { params: { ai_narrative } }
    ),
};
