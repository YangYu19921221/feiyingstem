const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

const api = (path: string, options?: RequestInit) =>
  fetch(`${API_BASE}/assessment${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  }).then(async r => {
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${r.status}`);
    }
    return r.json();
  });

export interface AssessmentWord {
  word_id: number;
  word: string;
  phonetic: string | null;
  meaning: string | null;
}

export interface WordScore {
  word: string;
  total_score: number;
  accuracy: number;
  fluency: number;
  integrity: number;
}

export interface BasicReport {
  session_id: string;
  avg_score: number;
  avg_accuracy: number;
  avg_fluency: number;
  grade_label: string;
  weak_areas: string[];
  scores: WordScore[];
}

export interface DeepReport {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  study_plan: string;
  focus_words: string[];
}

export const startAssessment = (grade_level: string) =>
  api('/start', { method: 'POST', body: JSON.stringify({ grade_level }) });

export const evaluateWord = async (sessionId: string, word: string, audioBlob: Blob) => {
  const form = new FormData();
  form.append('session_id', sessionId);
  form.append('word', word);
  form.append('audio', audioBlob, 'recording.webm');
  const res = await fetch(`${API_BASE}/assessment/evaluate`, { method: 'POST', body: form });
  if (!res.ok) throw new Error('评测失败');
  return res.json();
};

export const generateReport = (session_id: string, scores: WordScore[]) =>
  api('/report', { method: 'POST', body: JSON.stringify({ session_id, scores }) });

export const capturePhone = (session_id: string, phone: string) =>
  api('/capture-phone', { method: 'POST', body: JSON.stringify({ session_id, phone }) });

export const verifyPhone = (session_id: string, phone: string, code: string) =>
  api('/verify-phone', { method: 'POST', body: JSON.stringify({ session_id, phone, code }) });
