import { useCallback, useEffect, useState } from 'react';
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
  retry: () => void;
}

export function usePracticeQuestions({
  unitId,
  questionType,
  questionCount = 10,
}: UsePracticeQuestionsOptions): UsePracticeQuestionsResult {
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [unitInfo, setUnitInfo] = useState<UnitInfo | null>(null);
  const [unitWords, setUnitWords] = useState<WordData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const retry = useCallback(() => setRetryCount((count) => count + 1), []);

  useEffect(() => {
    if (!unitId) {
      setLoading(false);
      setError('没有找到这个单元，请返回单元列表重新进入。');
      return;
    }

    const id = Number.parseInt(unitId, 10);
    if (!Number.isFinite(id)) {
      setLoading(false);
      setError('这个单元地址不正确，请返回单元列表重新进入。');
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        setQuestions([]);

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

        if (!Array.isArray(qs) || qs.length === 0) {
          throw new Error('empty practice questions');
        }
        if (cancelled) return;

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
        if (!cancelled) {
          setError('题目暂时没有生成出来，请检查网络后重试。');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [unitId, questionType, questionCount, retryCount]);

  return { questions, unitInfo, unitWords, loading, error, retry };
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
