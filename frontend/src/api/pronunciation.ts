import { API_BASE_URL } from '../config/env';

const getAuthHeaders = () => {
  const token = localStorage.getItem('access_token') || localStorage.getItem('token');
  return { Authorization: `Bearer ${token}` };
};

export interface PronunciationScore {
  success: boolean;
  total_score: number;
  accuracy: number;
  fluency: number;
  integrity: number;
}

export async function evaluatePronunciation(
  audioBlob: Blob,
  text: string,
  category: string = 'read_word',
): Promise<PronunciationScore> {
  const form = new FormData();
  form.append('audio', audioBlob, 'recording.webm');
  form.append('text', text);
  form.append('category', category);

  const res = await fetch(`${API_BASE_URL}/pronunciation/evaluate`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '评测失败');
  }
  return res.json();
}

export async function checkPronunciationConfig(): Promise<boolean> {
  const res = await fetch(`${API_BASE_URL}/pronunciation/config-status`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data.configured === true;
}
