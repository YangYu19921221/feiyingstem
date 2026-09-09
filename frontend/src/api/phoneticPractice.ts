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
  /** 这一节在教的音素,目录页上色显示 —— 48 张卡片否则长得一模一样 */
  highlight?: string[];
  /** 写对过几个词(去重)。0 = 没练过 */
  mastered_count?: number;
  /** 最后练这节的时间,用来定位「继续上次」 */
  last_practiced_at?: string | null;
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
  /** 第二遍仍错、或这张卡已结束时返回 */
  answer_display?: string | null;
  /** 进第二遍时服务端回填的辅音格 */
  prefill?: (string | null)[] | null;
  /** 卡片背面揭示用。只在「做对了 / 第二遍判完」时下发,第一遍做错不给 */
  answer_tokens?: string[] | null;
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

/**
 * 单题判分 —— 卡片模式用(一张卡一次判,当场给对错)
 *
 * 与 checkPhoneticPage 是两种练法共用同一份判分口径(后端 _grade_one),
 * 不是两套规则:整页版一次交 20 题,卡片版一张一张交。
 */
export const checkPhoneticItem = (payload: {
  item_id: number;
  pass_number: number;
  submitted: (string | null)[];
  duration_ms?: number;
}): Promise<CheckResult> =>
  api.post('/phonetic-practice/check', payload) as unknown as Promise<CheckResult>;

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
