import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import './_axiosBootstrap';

// 选词填空 (word-bank cloze)：一个共享词库 + 多个句子，每空一词、每词一次
export interface ClozeBankWord {
  word_id: number;
  word: string;
}

export interface ClozeItem {
  word_id: number;
  answer: string;        // 该空正确单词
  sentence: string;      // 含 ______ 的英文句
  translation: string;   // 中文翻译
  phonetic?: string | null;
  meaning?: string | null;
}

export interface UnitClozeResponse {
  unit_id: number;
  unit_name: string;
  bank: ClozeBankWord[];
  items: ClozeItem[];
}

export const generateUnitCloze = async (
  unitId: number,
  blankCount = 6,
): Promise<UnitClozeResponse> => {
  const res = await axios.post(`${API_BASE_URL}/ai/generate-unit-cloze`, {
    unit_id: unitId,
    blank_count: blankCount,
  });
  return res.data;
};
