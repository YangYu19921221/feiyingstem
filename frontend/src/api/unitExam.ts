import client from './client';

export const EXAM_TYPE_LABELS: Record<string, string> = {
  en_to_cn: '英译中', cn_to_en: '中译英',
  listening: '听写', spelling: '拼写填空',
  sentence_fill: '例句填空',
};

export interface ExamQuestion {
  id: number;
  type: 'en_to_cn' | 'cn_to_en' | 'listening' | 'spelling' | 'sentence_fill';
  word_id: number;
  prompt?: string;
  options?: string[];
  hint?: string;
  word_length?: number;
  score: number;
}

export interface ExamData {
  exam_id: string;
  paper_id: number;
  unit_name: string;
  total_score: number;
  time_limit: number;
  question_count: number;
  questions: ExamQuestion[];
}

export interface ExamAnswerItem {
  question_id: number;
  answer: string;
}

export interface ExamDetail {
  question_id: number;
  type: string;
  user_answer: string;
  correct_answer: string;
  is_correct: boolean;
  score: number;
  max_score: number;
  word_id: number | null;
}

export interface ExamResult {
  submission_id: number;
  paper_id: number;
  score: number;
  max_score: number;
  accuracy: number;
  grade: string;
  correct_count: number;
  total_questions: number;
  time_spent: number;
  type_stats: Record<string, { total: number; correct: number }>;
  details: ExamDetail[];
  wrong_word_ids: number[];
}

export interface AIAnalysis {
  score: number;
  total_score: number;
  wrong_words: {
    word: string;
    meaning: string;
    question_type: string;
    user_answer: string;
    correct_answer: string;
  }[];
  error_patterns: Record<string, number>;
  analysis: {
    weak_areas: string[];
    suggestions: string[];
    focus_words: string[];
    accuracy?: number;
  };
}

// 生成考试试卷
export const generateExam = async (unitId: number): Promise<ExamData> => {
  return client.get(`/student/exam/generate/${unitId}`);
};

// 提交考试
export const submitExam = async (
  examId: string,
  answers: ExamAnswerItem[],
  timeSpent: number
): Promise<ExamResult> => {
  return client.post('/student/exam/submit', {
    exam_id: examId,
    answers,
    time_spent: timeSpent,
  });
};

// 获取AI分析
export const getExamAIAnalysis = async (paperId: number): Promise<AIAnalysis> => {
  return client.get(`/student/exam/result/${paperId}/ai-analysis`);
};
