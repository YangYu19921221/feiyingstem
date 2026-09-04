/**
 * 音标填空 API
 *
 * ⚠️ 答案不在前端。列表接口只给 slotCount(画几个空格),判分走 POST /check
 * 由服务端比对 —— 答案放前端等于学生打开开发者工具就能看到。
 */
import api from './client';

export interface PhoneticItem {
  id: number;
  word: string;
  meaning?: string | null;
  /** 答案有几个音素 = 画几个空格。刻意给长度提示,省掉「长度也要猜」的额外难度 */
  slot_count: number;
}

export interface PhoneticLesson {
  id: number;
  code: string;
  title: string;
  highlight: string[];
  video_id?: number | null;
  items: PhoneticItem[];
}

export interface LessonBrief {
  id: number;
  code: string;
  title: string;
  lesson_number: number;
  item_count: number;
  /** >0 表示这节剔过敏感词,标出来免得老师以为系统漏词 */
  removed_count: number;
  has_video: boolean;
}

export interface PhoneticBook {
  id: number;
  name: string;
  volume?: string | null;
  lessons: LessonBrief[];
}

export interface CheckResult {
  all_correct: boolean;
  per_slot: (boolean | null)[];
  wrong_indexes: number[];
  next_blanks: number[];
  /** 只在第二遍仍错时返回 */
  answer_display?: string | null;
  /** 进第二遍时服务端回填的辅音格 */
  prefill?: (string | null)[] | null;
}

export interface PageItemResult {
  item_id: number;
  all_correct: boolean;
  per_slot: (boolean | null)[];
  wrong_indexes: number[];
  next_blanks: number[];
  answer_display?: string | null;
  prefill?: (string | null)[] | null;
}

export interface CheckPageResult {
  right_count: number;
  total: number;
  results: PageItemResult[];
}

// ⚠️ client.ts 的响应拦截器已经 return response.data,所以这里**不能**再解构 { data }
// —— 那样拿到的是 undefined,页面会永远卡在 loading 且不报错
export const listPhoneticBooks = (): Promise<PhoneticBook[]> =>
  api.get('/phonetic-practice/books') as unknown as Promise<PhoneticBook[]>;

export const fetchPhoneticLesson = (lessonId: string | number): Promise<PhoneticLesson> =>
  api.get(`/phonetic-practice/lessons/${lessonId}`) as unknown as Promise<PhoneticLesson>;

/** 整页交卷:纸书一页 20 个词一次判完,不是 20 个请求 */
export const checkPhoneticPage = (payload: {
  lesson_id: number;
  pass_number: number;
  answers: { item_id: number; submitted: (string | null)[] }[];
  duration_ms?: number;
  /** 幂等键,弱网连点两次不重复记账 */
  attempt_id?: string;
}): Promise<CheckPageResult> =>
  api.post('/phonetic-practice/check-page', payload) as unknown as Promise<CheckPageResult>;
