import client from './client';

export interface SentenceBook {
  id: number;
  name: string;
  description: string | null;
  grade_level: string | null;
  volume: string | null;
  cover_color: string;
  cover_url: string | null;
  is_public: boolean;
  unit_count: number;
  sentence_count: number;
}

export interface SentenceUnit {
  id: number;
  book_id: number;
  unit_number: number;
  name: string;
  description: string | null;
  order_index: number;
  sentence_count: number;
}

export interface Sentence {
  id: number;
  unit_id: number;
  order_index: number;
  english: string;
  chinese: string;
  phonetic: string | null;
  tts_text: string | null;
  difficulty: number;
  topic: string | null;
  grammar_focus: string | null;
}

export interface BulkImportResult {
  added: number;
  skipped: number;
  errors: string[];
}

// Books
export const listSentenceBooks = () => client.get<SentenceBook[]>('/sentences/books');
export const createSentenceBook = (body: Partial<SentenceBook>) => client.post<SentenceBook>('/sentences/books', body);
export const updateSentenceBook = (id: number, body: Partial<SentenceBook>) =>
  client.patch<SentenceBook>(`/sentences/books/${id}`, body);
export const deleteSentenceBook = (id: number) => client.delete(`/sentences/books/${id}`);

// Units
export const listSentenceUnits = (bookId: number) =>
  client.get<SentenceUnit[]>(`/sentences/books/${bookId}/units`);
export const createSentenceUnit = (bookId: number, body: { name: string; description?: string }) =>
  client.post<SentenceUnit>(`/sentences/books/${bookId}/units`, body);
export const updateSentenceUnit = (unitId: number, body: { name?: string; description?: string }) =>
  client.patch<SentenceUnit>(`/sentences/units/${unitId}`, body);
export const deleteSentenceUnit = (unitId: number) => client.delete(`/sentences/units/${unitId}`);

// Sentences
export const listSentences = (unitId: number) =>
  client.get<Sentence[]>(`/sentences/units/${unitId}/sentences`);
export const createSentence = (unitId: number, body: Partial<Sentence>) =>
  client.post<Sentence>(`/sentences/units/${unitId}/sentences`, body);
export const updateSentence = (id: number, body: Partial<Sentence>) =>
  client.patch<Sentence>(`/sentences/sentences/${id}`, body);
export const deleteSentence = (id: number) => client.delete(`/sentences/sentences/${id}`);

export const bulkImportSentences = async (unitId: number, file: File): Promise<BulkImportResult> => {
  const fd = new FormData();
  fd.append('file', file);
  return client.post<BulkImportResult>(`/sentences/units/${unitId}/bulk-import`, fd);
};
