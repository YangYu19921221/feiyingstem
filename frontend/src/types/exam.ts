/**
 * 试卷相关类型定义
 */

export interface StudentMistakeAnalysis {
  total_words: number;
  weak_words: Array<{
    word: string;
    meaning: string;
    wrong_count: number;
    correct_count: number;
  }>;
  weak_question_types: string[];
  recommended_distribution: {
    choice: number;
    fill_blank: number;
    spelling: number;
    reading: number;
  };
  difficulty_level: string;
  accuracy_rate: number;
}

export interface ExamQuestion {
  question_number: number;
  question_type: string;
  content: string;
  correct_answer: string;
  explanation?: string;
  score: number;
  word?: string;
  options?: Array<{
    key: string;
    text: string;
  }>;
  passage?: string;
  passage_id?: string;  // 用于分组阅读理解文章
  passage_title?: string;  // 阅读理解文章标题
  blanks?: Array<{  // 完形填空的多个空
    blank_number: number;
    content: string;
    options: Array<{
      key: string;
      text: string;
    }>;
    correct_answer: string;
    explanation: string;
    score: number;
    word?: string;
  }>;
}

export interface ExamPaper {
  id: number;
  title: string;
  description: string;
  total_score: number;
  student_id: number;
  generated_by_ai: boolean;
  created_at: string;
  questions: ExamQuestion[];
}

export interface GenerateExamRequest {
  student_id: number;
  question_count?: number;
  custom_distribution?: {
    choice?: number;
    fill_blank?: number;
    spelling?: number;
    reading?: number;
  };
  difficulty?: string;
}
