import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import { startLearning, type WordData } from '../api/progress';

export interface QuizQuestion {
  word_id: number;
  word: string;
  question: string;
  options?: string[];
  correct_answer: string;
  explanation: string;
  phonetic?: string;
  meaning?: string;
}

interface UnitInfo {
  id: number;
  unit_number: number;
  name: string;
  description: string | null;
  book_id: number;
}

interface UsePracticeQuestionsOptions {
  unitId: string | undefined;
  questionType: 'choice' | 'spelling' | 'fillblank';
  questionCount?: number;
}

interface UsePracticeQuestionsResult {
  questions: QuizQuestion[];
  unitInfo: UnitInfo | null;
  unitWords: WordData[];
  loading: boolean;
  error: string | null;
}

export function usePracticeQuestions({
  unitId,
  questionType,
  questionCount = 10,
}: UsePracticeQuestionsOptions): UsePracticeQuestionsResult {
  const navigate = useNavigate();
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [unitInfo, setUnitInfo] = useState<UnitInfo | null>(null);
  const [unitWords, setUnitWords] = useState<WordData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!unitId) return;
    const id = parseInt(unitId);

    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        const isMistakePractice = sessionStorage.getItem('is_mistake_practice') === 'true';

        // 并行请求：题目 + 单元信息
        const questionsPromise = isMistakePractice && id === 0
          ? loadMistakeQuestions(questionType)
          : loadUnitQuestions(id, questionType, questionCount);

        // 只在非错题模式下获取单元信息
        const unitInfoPromise = (!isMistakePractice || id !== 0)
          ? startLearning({ unit_id: id, learning_mode: 'flashcard' }).catch(() => null)
          : Promise.resolve(null);

        const [qs, unitData] = await Promise.all([questionsPromise, unitInfoPromise]);

        setQuestions(qs);
        if (unitData) {
          setUnitInfo(unitData.unit_info);
          setUnitWords(unitData.words);
        }

        if (isMistakePractice) {
          sessionStorage.removeItem('is_mistake_practice');
        }
      } catch (err) {
        console.error('加载题目失败:', err);
        setError('加载题目失败,请重试');
        alert('加载题目失败,请重试');
        navigate(-1);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [unitId, questionType, questionCount, navigate]);

  return { questions, unitInfo, unitWords, loading, error };
}

async function loadMistakeQuestions(
  questionType: string,
): Promise<QuizQuestion[]> {
  const mistakeWordsJson = sessionStorage.getItem('mistake_practice_words');
  if (!mistakeWordsJson) {
    throw new Error('错题数据丢失');
  }
  const mistakeWords = JSON.parse(mistakeWordsJson);
  const wordIds = mistakeWords.map((w: any) => w.word_id);
  const response = await axios.post(`${API_BASE_URL}/ai/generate-quiz-from-words`, {
    word_ids: wordIds,
    question_count: Math.min(wordIds.length, 20),
    question_type: questionType,
  });
  return response.data.questions;
}

async function loadUnitQuestions(
  unitId: number,
  questionType: string,
  questionCount: number,
): Promise<QuizQuestion[]> {
  const response = await axios.post(`${API_BASE_URL}/ai/generate-unit-quiz`, {
    unit_id: unitId,
    question_count: questionCount,
    question_type: questionType,
  });
  return response.data.questions;
}
