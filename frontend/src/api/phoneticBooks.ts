/**
 * 教师端音标教材管理 API
 *
 * Excel 在**浏览器里**解(SheetJS),只把行数据当 JSON 传给后端 ——
 * 与单词导入(TeacherBooks.tsx)同套路,后端不收文件。
 */
import api from './client';

export interface PhoneticBookOut {
  id: number;
  name: string;
  volume?: string | null;
  description?: string | null;
  is_active: boolean;
  lesson_count: number;
  item_count: number;
  /** 平台预置(所有机构共享)。机构只能看不能改 */
  is_preset: boolean;
  can_edit: boolean;
  /** 指定了发音的词数 */
  tts_count?: number;
}

export interface PhoneticLessonBrief {
  id: number;
  code: string;
  title: string;
  lesson_number: number;
  item_count: number;
  removed_count: number;
  tts_count?: number;
}

export interface ImportRow {
  word: string;
  phonetic: string;
  meaning?: string | null;
  /** 「发音」列:标准音按这个读(cede 填 seed)。空 = 按单词读 */
  tts?: string | null;
}

export interface ImportLesson {
  code: string;
  title: string;
  rows: ImportRow[];
}

export interface ImportPayload {
  book_name: string;
  volume?: string | null;
  description?: string | null;
  lessons: ImportLesson[];
  replace?: boolean;
}

export interface RowError {
  lesson: string;
  word: string;
  reason: string;
}

export interface ValidateOut {
  ok: boolean;
  lesson_count: number;
  item_count: number;
  errors: RowError[];
  existing_book_id?: number | null;
  existing_item_count?: number | null;
  /** 填了「发音」的行数 */
  tts_count?: number;
}

export interface ImportOut {
  book_id: number;
  book_name: string;
  lesson_count: number;
  item_count: number;
  replaced: boolean;
}

// client.ts 的拦截器已 return response.data,这里不能再解构 { data }
const B = '/teacher/phonetic-books';

export const fetchPhoneticBooks = (): Promise<PhoneticBookOut[]> =>
  api.get(`${B}/books`) as unknown as Promise<PhoneticBookOut[]>;

export const fetchPhoneticLessons = (bookId: number): Promise<PhoneticLessonBrief[]> =>
  api.get(`${B}/books/${bookId}/lessons`) as unknown as Promise<PhoneticLessonBrief[]>;

/** 先校验:让老师在写库**之前**看到哪几行音标不合格 */
export const validatePhoneticImport = (p: ImportPayload): Promise<ValidateOut> =>
  api.post(`${B}/books/validate`, p) as unknown as Promise<ValidateOut>;

/** 真导入。有任何一行不合格后端会整本拒掉(400) */
export const importPhoneticBook = (p: ImportPayload): Promise<ImportOut> =>
  api.post(`${B}/books/import`, p) as unknown as Promise<ImportOut>;

export const updatePhoneticBook = (
  bookId: number,
  patch: Partial<Pick<PhoneticBookOut, 'name' | 'volume' | 'description' | 'is_active'>>,
): Promise<PhoneticBookOut> =>
  api.patch(`${B}/books/${bookId}`, patch) as unknown as Promise<PhoneticBookOut>;

/** 一本书的全部题(改发音用) */
export interface BookItem {
  id: number;
  lesson_id: number;
  code: string;
  word: string;
  phonetic: string;
  meaning?: string | null;
  tts_text?: string | null;
}

export const fetchBookItems = (bookId: number): Promise<BookItem[]> =>
  api.get(`${B}/books/${bookId}/items`) as unknown as Promise<BookItem[]>;

/**
 * 只改发音,按题目 id。题目、id、学生进度和录音都不动(整本替换会换掉所有 id)。
 * tts 空 = 改回按单词读。有一个不合格后端一个都不改(400)
 */
export const updateBookTts = (
  bookId: number,
  items: Array<{ id: number; tts: string | null }>,
): Promise<{ updated: number; with_tts: number }> =>
  api.post(`${B}/books/${bookId}/tts`, { items }) as unknown as Promise<{ updated: number; with_tts: number }>;

export const deletePhoneticBook = (bookId: number): Promise<{ deleted: boolean }> =>
  api.delete(`${B}/books/${bookId}`) as unknown as Promise<{ deleted: boolean }>;
