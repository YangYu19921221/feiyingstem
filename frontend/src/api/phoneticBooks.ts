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
}

export interface PhoneticLessonBrief {
  id: number;
  code: string;
  title: string;
  lesson_number: number;
  item_count: number;
  removed_count: number;
}

export interface ImportRow {
  word: string;
  phonetic: string;
  meaning?: string | null;
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

export const deletePhoneticBook = (bookId: number): Promise<{ deleted: boolean }> =>
  api.delete(`${B}/books/${bookId}`) as unknown as Promise<{ deleted: boolean }>;
