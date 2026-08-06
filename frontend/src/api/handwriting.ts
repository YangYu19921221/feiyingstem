import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import './_axiosBootstrap';

export interface HandwritingGradeResult {
  word_id: number;
  word: string;
  written: string; // AI 认出的学生手写内容(空串=没写/认不出)
  is_correct: boolean;
}

export interface HandwritingGradeResponse {
  results: HandwritingGradeResult[];
  correct_count: number;
  total: number;
}

/**
 * 拍照批改听写答题纸。
 * 照片只在服务端内存过一遍即弃,不存储;word_ids 顺序必须与报词顺序一致。
 */
export const gradeHandwriting = async (
  wordIds: number[],
  image: Blob,
): Promise<HandwritingGradeResponse> => {
  const formData = new FormData();
  formData.append('image', image, 'sheet.jpg');
  formData.append('word_ids', JSON.stringify(wordIds));
  const response = await axios.post(`${API_BASE_URL}/student/handwriting/grade`, formData, {
    timeout: 90_000, // 视觉模型整页识别偏慢,给足余量
  });
  return response.data;
};
